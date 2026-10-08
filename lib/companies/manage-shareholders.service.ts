/**
 * Shareholders (capital table) of a company: list, create, update, delete.
 * Used by /api/companies/[id]/shareholders.
 *
 * Invariants owned here:
 * - the share percentages of a company add up to 100 % at most, checked in
 *   hundredths (lib/companies/shareholder-values.ts) under a per-company
 *   advisory lock, so two concurrent writes cannot both pass the check;
 * - a natural person (PHYSICAL) is a Person of the company (or already one
 *   of its shareholders);
 * - a shareholder company (LEGAL with companyShareholderId) is another
 *   company where the user may change the settings (KLEDG-R3-AUTHZ-03: the
 *   link makes this company a subsidiary in that company's group space, so a
 *   viewer of it cannot declare one); a legal person that is not a company
 *   of the instance has a name (and optionally a SIRET).
 *
 * Ids of other companies are answered like missing rows.
 */

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { getUserRolesForCompany, isGlobalAdmin, rolesGrant } from '@/lib/rbac/authorize'
import { withUserContext } from '@/lib/rls/context'
import type { CurrentUser } from '@/lib/session'
import {
  assertTotalPercentage,
  hundredthsToDecimal,
  parseCapitalAmount,
  parseSharePercentage,
} from './shareholder-values'

const SHAREHOLDER_NOT_FOUND_MESSAGE = 'Actionnaire introuvable'
const UNKNOWN_PERSON_MESSAGE = "La personne spécifiée n'existe pas"
const UNKNOWN_COMPANY_MESSAGE = "La société actionnaire spécifiée n'existe pas"
export const SHAREHOLDER_COMPANY_FORBIDDEN_MESSAGE =
  'Pour déclarer une société actionnaire, vous devez pouvoir modifier ses paramètres (administrateur de cette société).'

/** A number or a decimal string, as forms send them; checked exactly by shareholder-values. */
const decimalInput = z.union([z.number(), z.string(), z.null()]).optional()

const shareholderType = z.enum(['PHYSICAL', 'LEGAL'], { error: "Le type d'actionnaire doit être PHYSICAL ou LEGAL" })

const shareholderFields = {
  name: z.string().max(200).nullable().optional(),
  siret: z.string().max(20).nullable().optional(),
  numberOfShares: decimalInput,
  capitalAmount: decimalInput,
  companyShareholderId: z.string().nullable().optional(),
  personId: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}

/** Body of POST /api/companies/[id]/shareholders. */
export const CreateShareholderSchema = z.object({
  type: z.enum(['PHYSICAL', 'LEGAL'], { error: "Le type d'actionnaire est requis (PHYSICAL ou LEGAL)" }),
  sharePercentage: z.union([z.number(), z.string()], { error: 'Le pourcentage de participation est requis' }),
  ...shareholderFields,
})

/** Body of PATCH /api/companies/[id]/shareholders/[shareholderId]: every field optional. */
export const UpdateShareholderSchema = z.object({
  type: shareholderType.optional(),
  sharePercentage: decimalInput,
  ...shareholderFields,
})

export type CreateShareholderInput = z.infer<typeof CreateShareholderSchema>
export type UpdateShareholderInput = z.infer<typeof UpdateShareholderSchema>

const PERSON_SELECT = { id: true, firstName: true, name: true, email: true, phone: true, address: true, photo: true } as const
const COMPANY_SHAREHOLDER_SELECT = { id: true, name: true, siren: true, legalType: true } as const

type Actor = Pick<CurrentUser, 'id' | 'role'>

/** Serializes writes to the capital table of one company (the 100 % check reads, then writes). */
async function lockCapitalTable(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:shareholders:${companyId}`}))`
}

/** The person must belong to the company (person.companyId) or already be one of its shareholders. */
async function assertPersonOfCompany(tx: Prisma.TransactionClient, personId: string, companyId: string): Promise<string> {
  const person = await tx.person.findFirst({
    where: { id: personId, OR: [{ companyId }, { shareholders: { some: { companyId } } }] },
    select: { id: true },
  })
  if (!person) throw new ValidationError(UNKNOWN_PERSON_MESSAGE)
  return person.id
}

/**
 * A shareholder company must be another company the user can access (member
 * of it, or instance administrator). A new link also needs `settings:update`
 * in that company: it makes the edited company one of its subsidiaries
 * (kledg_group_subsidiary_ids, its group space, annexe and tax group), which
 * only someone who may change that company's settings decides. Keeping an
 * existing link (`linking` false) only needs access.
 */
async function assertShareholderCompany(
  shareholderCompanyId: string,
  companyId: string,
  actor: Actor,
  linking = true,
): Promise<{ id: string; name: string }> {
  if (shareholderCompanyId === companyId) throw new ValidationError("Une société ne peut pas être actionnaire d'elle-même")
  // The route narrows its statements to the company being edited (docs/rls.md),
  // which hides the shareholder company and its memberships: both are read in
  // the shareholder company's own scope, where the database still requires the
  // user's membership. Called before the transaction, whose context is fixed
  // when it starts.
  const company = await withUserContext(
    actor.id,
    async () => {
      const roles = isGlobalAdmin(actor) ? null : await getUserRolesForCompany(actor.id, shareholderCompanyId)
      if (roles && roles.length === 0) return null
      const found = await prisma.company.findUnique({ where: { id: shareholderCompanyId }, select: { id: true, name: true } })
      return found && { ...found, mayLink: !roles || rolesGrant(roles, { settings: ['update'] }) }
    },
    { companyIds: [shareholderCompanyId] },
  )
  if (!company) throw new ValidationError(UNKNOWN_COMPANY_MESSAGE)
  if (linking && !company.mayLink) throw new ForbiddenError(SHAREHOLDER_COMPANY_FORBIDDEN_MESSAGE)
  return { id: company.id, name: company.name }
}

/** Percentages of the company's shareholders, the new one included, stay within 100 %. */
async function assertCapitalTableTotal(
  tx: Prisma.TransactionClient,
  companyId: string,
  hundredths: number,
  exceptShareholderId?: string,
): Promise<void> {
  const others = await tx.shareholder.findMany({
    where: { companyId, ...(exceptShareholderId ? { id: { not: exceptShareholderId } } : {}) },
    select: { sharePercentage: true },
  })
  assertTotalPercentage(
    others.map((sh) => sh.sharePercentage),
    hundredths,
  )
}

function sharesCount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const shares = Number.parseInt(String(value), 10)
  if (!Number.isSafeInteger(shares) || shares < 0) throw new ValidationError('Le nombre de parts est invalide')
  return shares
}

/** Shareholders of the company, oldest first, with their person or company. */
export function listShareholders(companyId: string) {
  return prisma.shareholder.findMany({
    where: { companyId },
    include: { companyShareholder: { select: COMPANY_SHAREHOLDER_SELECT }, person: { select: PERSON_SELECT } },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createShareholder(companyId: string, input: CreateShareholderInput, actor: Actor) {
  const shareholderCompany =
    input.type === 'LEGAL' && input.companyShareholderId
      ? await assertShareholderCompany(input.companyShareholderId, companyId, actor)
      : null
  return prisma.$transaction(async (tx) => {
    let personId: string | null = null
    if (input.type === 'PHYSICAL') {
      if (!input.personId) {
        throw new ValidationError(
          'Pour une personne physique, vous devez sélectionner une personne existante ou en créer une nouvelle',
        )
      }
      personId = await assertPersonOfCompany(tx, input.personId, companyId)
    }

    if (input.type === 'LEGAL' && !input.companyShareholderId && !input.name) {
      throw new ValidationError('Le nom est requis pour une personne morale non-société')
    }

    const shareHundredths = parseSharePercentage(input.sharePercentage)
    const capitalAmount = parseCapitalAmount(input.capitalAmount)

    await lockCapitalTable(tx, companyId)
    await assertCapitalTableTotal(tx, companyId, shareHundredths)

    // A company has a SIREN, not a SIRET: the SIRET stays empty for company shareholders
    const legalPerson = input.type === 'LEGAL' && !shareholderCompany
    return tx.shareholder.create({
      data: {
        companyId,
        type: input.type,
        name: shareholderCompany ? shareholderCompany.name : legalPerson ? input.name || null : null,
        siret: legalPerson ? input.siret || null : null,
        sharePercentage: hundredthsToDecimal(shareHundredths),
        numberOfShares: sharesCount(input.numberOfShares),
        capitalAmount,
        companyShareholderId: shareholderCompany?.id ?? null,
        personId,
        notes: input.notes || null,
      },
      include: {
        person: { select: { id: true, firstName: true, name: true, email: true } },
        companyShareholder: { select: COMPANY_SHAREHOLDER_SELECT },
      },
    })
  })
}

export async function updateShareholder(
  companyId: string,
  shareholderId: string,
  input: UpdateShareholderInput,
  actor: Actor,
) {
  // Only a new link needs the right to change the shareholder company's settings.
  const current = input.companyShareholderId
    ? await prisma.shareholder.findFirst({ where: { id: shareholderId, companyId }, select: { companyShareholderId: true } })
    : null
  const shareholderCompany = input.companyShareholderId
    ? await assertShareholderCompany(input.companyShareholderId, companyId, actor, current?.companyShareholderId !== input.companyShareholderId)
    : null
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shareholder.findFirst({
      where: { id: shareholderId, companyId },
      select: { id: true, type: true, personId: true },
    })
    if (!existing) throw new NotFoundError(SHAREHOLDER_NOT_FOUND_MESSAGE)

    let shareHundredths: number | undefined
    if (input.sharePercentage !== undefined && input.sharePercentage !== null) {
      shareHundredths = parseSharePercentage(input.sharePercentage)
      await lockCapitalTable(tx, companyId)
      await assertCapitalTableTotal(tx, companyId, shareHundredths, existing.id)
    }
    const capitalAmount = input.capitalAmount !== undefined ? parseCapitalAmount(input.capitalAmount) : undefined

    // A natural person keeps its person unless another one of the company is given
    let personId: string | null = null
    if (input.type === 'PHYSICAL' || (existing.type === 'PHYSICAL' && input.type === undefined)) {
      personId = input.personId ? await assertPersonOfCompany(tx, input.personId, companyId) : existing.personId
    }

    const data: Prisma.ShareholderUncheckedUpdateInput = {
      ...(input.type && { type: input.type }),
      ...(shareHundredths !== undefined && { sharePercentage: hundredthsToDecimal(shareHundredths) }),
      ...(input.numberOfShares !== undefined && { numberOfShares: sharesCount(input.numberOfShares) }),
      ...(capitalAmount !== undefined && { capitalAmount }),
      ...(input.companyShareholderId !== undefined && { companyShareholderId: shareholderCompany?.id ?? null }),
      personId,
      ...(input.notes !== undefined && { notes: input.notes || null }),
    }

    // The type may be left out: a legal person keeps its type when it is linked to a company.
    const type = input.type ?? existing.type
    if (type === 'LEGAL' && input.companyShareholderId !== undefined) {
      if (shareholderCompany) {
        data.name = shareholderCompany.name
        data.siret = null
      } else {
        data.name = input.name || null
        data.siret = input.siret || null
      }
    } else if (input.type === 'LEGAL' && input.name !== undefined) {
      data.name = input.name
      if (input.siret !== undefined) data.siret = input.siret || null
    } else if (input.type === 'PHYSICAL') {
      data.name = null
      data.siret = null
    }

    return tx.shareholder.update({
      where: { id: existing.id },
      data,
      include: { person: { select: PERSON_SELECT } },
    })
  })
}

export async function deleteShareholder(companyId: string, shareholderId: string): Promise<void> {
  const { count } = await prisma.shareholder.deleteMany({ where: { id: shareholderId, companyId } })
  if (count === 0) throw new NotFoundError(SHAREHOLDER_NOT_FOUND_MESSAGE)
}
