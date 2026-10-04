/**
 * Claimants of expense reports (bénéficiaires): the employees, dirigeants
 * and associés a company reimburses.
 *
 * Invariants owned here:
 * - a claimant belongs to one company and is linked at most to one Person
 *   of that company (or a shareholder of it) and to one member (a user of
 *   the company's organization); both checked against the company, never
 *   taken as is from the request;
 * - its credited account is a third-party account the lettering accepts
 *   (421, 425, 455 or 467 and their subaccounts, lib/lettering/rules.ts),
 *   also checked by the database (expense_claimants_account_check); empty,
 *   the default of its kind (status.ts DEFAULT_CLAIMANT_ACCOUNT);
 * - its auxiliary account number (FEC CompAuxNum) is unique in the company
 *   and never changes once a report is posted for it: posted lines are not
 *   rewritten, and lettering groups lines by that number;
 * - a claimant with reports is never deleted (ON DELETE RESTRICT).
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { CLAIMANT_AUX_PREFIX } from './status'
import type { ExpenseActor } from './actor'

type Db = Prisma.TransactionClient | typeof prisma

export const CLAIMANT_NOT_FOUND = 'Bénéficiaire introuvable'

const kindSchema = z.enum(['EMPLOYEE', 'DIRIGEANT', 'ASSOCIE'], { error: 'Choisissez salarié, dirigeant ou associé' })
const accountSchema = optionalText(20).refine(
  (code) => code === undefined || code === null || /^(421|425|455|467)[0-9A-Z]*$/.test(code),
  'Le compte d’un bénéficiaire est un compte 421, 425, 455 ou 467 (ou un sous-compte)',
)
const auxSchema = optionalText(17).refine((v) => v === undefined || v === null || /^[0-9A-Z]{1,17}$/.test(v), 'Compte auxiliaire\u00a0: lettres majuscules et chiffres, 17 caractères au plus')

/** Body of POST /api/expense-claimants. */
export const CreateClaimantBodySchema = z.object({
  kind: kindSchema,
  name: z.string({ error: 'Le nom est requis' }).trim().min(1, 'Le nom est requis').max(200),
  personId: z.string().max(64).nullish(),
  userId: z.string().max(64).nullish(),
  accountCode: accountSchema,
  auxiliaryAccountNumber: auxSchema,
})
export type CreateClaimantInput = z.infer<typeof CreateClaimantBodySchema>

/** Body of PATCH /api/expense-claimants/[id]. */
export const UpdateClaimantBodySchema = CreateClaimantBodySchema.partial()

const CLAIMANT_SELECT = {
  id: true,
  kind: true,
  name: true,
  personId: true,
  userId: true,
  accountCode: true,
  auxiliaryAccountNumber: true,
  _count: { select: { reports: true } },
} satisfies Prisma.ExpenseClaimantSelect

export type ClaimantRow = Prisma.ExpenseClaimantGetPayload<{ select: typeof CLAIMANT_SELECT }>

export async function listClaimants(companyId: string, actor: ExpenseActor): Promise<{ claimants: ClaimantRow[] }> {
  const claimants = await prisma.expenseClaimant.findMany({
    where: { companyId, ...(actor.canManage ? {} : { userId: actor.userId }) },
    select: CLAIMANT_SELECT,
    orderBy: { name: 'asc' },
    take: 1000,
  })
  return { claimants }
}

async function lockClaimants(tx: Prisma.TransactionClient, companyId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:expense-claimants:${companyId}`}))`
}

/** Next free auxiliary number of a kind: S00001 for salariés, D00001 for dirigeants, A00001 for associés. */
async function nextAuxiliaryNumber(db: Db, companyId: string, kind: keyof typeof CLAIMANT_AUX_PREFIX): Promise<string> {
  const prefix = CLAIMANT_AUX_PREFIX[kind]
  const rows = await db.$queryRaw<Array<{ max: string | null }>>`
    SELECT MAX("auxiliaryAccountNumber") AS max FROM "expense_claimants"
    WHERE "companyId" = ${companyId} AND "auxiliaryAccountNumber" ~ ${`^${prefix}[0-9]{5}$`}`
  const current = rows[0]?.max ? Number(rows[0].max.slice(1)) : 0
  return `${prefix}${String(current + 1).padStart(5, '0')}`
}

/** A person of the company: its own, or a shareholder of it. */
async function assertPersonOfCompany(db: Db, companyId: string, personId: string) {
  const person = await db.person.findFirst({
    where: { id: personId, OR: [{ companyId }, { shareholders: { some: { companyId } } }] },
    select: { id: true },
  })
  if (!person) throw new NotFoundError('Personne introuvable dans cette société')
}

/** A user who is a member of the company. */
async function assertMemberOfCompany(db: Db, companyId: string, userId: string) {
  const member = await db.member.findFirst({ where: { userId, organization: { companyId } }, select: { id: true } })
  if (!member) throw new NotFoundError('Ce membre n’appartient pas à la société')
}

/** One claimant per member and per person of the company. */
async function assertLinksFree(db: Db, companyId: string, links: { personId?: string | null; userId?: string | null }, exceptId?: string) {
  const except = exceptId ? { id: { not: exceptId } } : {}
  if (links.userId && (await db.expenseClaimant.findFirst({ where: { companyId, userId: links.userId, ...except }, select: { id: true } }))) {
    throw new ConflictError('Ce membre a déjà sa fiche de bénéficiaire.')
  }
  if (links.personId && (await db.expenseClaimant.findFirst({ where: { companyId, personId: links.personId, ...except }, select: { id: true } }))) {
    throw new ConflictError('Cette personne a déjà sa fiche de bénéficiaire.')
  }
}

async function assertAuxFree(db: Db, companyId: string, aux: string, exceptId?: string) {
  const clash = await db.expenseClaimant.findFirst({ where: { companyId, auxiliaryAccountNumber: aux, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } })
  if (clash) throw new ConflictError(`Le compte auxiliaire ${aux} est déjà celui de ${clash.name}.`)
}

function uniqueClash(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = String((error.meta as { target?: unknown } | undefined)?.target ?? '')
    if (target.includes('userId')) return 'Ce membre a déjà sa fiche de bénéficiaire.'
    if (target.includes('personId')) return 'Cette personne a déjà sa fiche de bénéficiaire.'
    return 'Ce compte auxiliaire est déjà utilisé.'
  }
  return null
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const

export async function createClaimant(companyId: string, input: CreateClaimantInput): Promise<ClaimantRow> {
  try {
    const created = await prisma.$transaction(async (tx) => {
      if (input.personId) await assertPersonOfCompany(tx, companyId, input.personId)
      if (input.userId) await assertMemberOfCompany(tx, companyId, input.userId)
      await lockClaimants(tx, companyId)
      await assertLinksFree(tx, companyId, input)
      const aux = input.auxiliaryAccountNumber ?? (await nextAuxiliaryNumber(tx, companyId, input.kind))
      await assertAuxFree(tx, companyId, aux)
      return tx.expenseClaimant.create({
        data: {
          companyId,
          kind: input.kind,
          name: input.name,
          personId: input.personId ?? null,
          userId: input.userId ?? null,
          accountCode: input.accountCode ?? null,
          auxiliaryAccountNumber: aux,
        },
        select: CLAIMANT_SELECT,
      })
    }, TX_OPTIONS)
    await writeAuditLog('info', `Expense claimant created: ${created.auxiliaryAccountNumber}`, { action: 'CREATE_EXPENSE_CLAIMANT', companyId, metadata: { claimantId: created.id } })
    return created
  } catch (error) {
    const clash = uniqueClash(error)
    if (clash) throw new ConflictError(clash)
    throw error
  }
}

export async function updateClaimant(companyId: string, id: string, input: z.infer<typeof UpdateClaimantBodySchema>): Promise<ClaimantRow> {
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await lockClaimants(tx, companyId)
      const current = await tx.expenseClaimant.findFirst({ where: { id, companyId }, select: { id: true, auxiliaryAccountNumber: true } })
      if (!current) throw new NotFoundError(CLAIMANT_NOT_FOUND)
      if (input.personId) await assertPersonOfCompany(tx, companyId, input.personId)
      if (input.userId) await assertMemberOfCompany(tx, companyId, input.userId)
      await assertLinksFree(tx, companyId, input, id)
      if (input.auxiliaryAccountNumber && input.auxiliaryAccountNumber !== current.auxiliaryAccountNumber) {
        const posted = await tx.expenseReport.count({ where: { claimantId: id, companyId, entryId: { not: null } } })
        if (posted > 0) {
          throw new ConflictError('Des notes de frais de ce bénéficiaire sont comptabilisées\u00a0: son compte auxiliaire ne change plus (les écritures passées ne sont pas réécrites).')
        }
        await assertAuxFree(tx, companyId, input.auxiliaryAccountNumber, id)
      }
      return tx.expenseClaimant.update({
        where: { id },
        data: {
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.personId !== undefined ? { personId: input.personId } : {}),
          ...(input.userId !== undefined ? { userId: input.userId } : {}),
          ...(input.accountCode !== undefined ? { accountCode: input.accountCode } : {}),
          ...(input.auxiliaryAccountNumber ? { auxiliaryAccountNumber: input.auxiliaryAccountNumber } : {}),
        },
        select: CLAIMANT_SELECT,
      })
    }, TX_OPTIONS)
    await writeAuditLog('info', `Expense claimant updated: ${updated.auxiliaryAccountNumber}`, { action: 'UPDATE_EXPENSE_CLAIMANT', companyId, metadata: { claimantId: id } })
    return updated
  } catch (error) {
    const clash = uniqueClash(error)
    if (clash) throw new ConflictError(clash)
    throw error
  }
}

export async function deleteClaimant(companyId: string, id: string): Promise<{ id: string }> {
  const claimant = await prisma.expenseClaimant.findFirst({ where: { id, companyId }, select: { id: true, _count: { select: { reports: true } } } })
  if (!claimant) throw new NotFoundError(CLAIMANT_NOT_FOUND)
  if (claimant._count.reports > 0) throw new ConflictError('Ce bénéficiaire a des notes de frais\u00a0: il ne peut plus être supprimé.')
  await prisma.expenseClaimant.delete({ where: { id } })
  await writeAuditLog('info', 'Expense claimant deleted', { action: 'DELETE_EXPENSE_CLAIMANT', companyId, metadata: { claimantId: id } })
  return { id }
}

/**
 * The claimant of the acting user in the company, created on their first
 * report as a salarié with their name (an administrator changes the kind
 * and the account later). Runs in the caller's transaction.
 */
export async function ensureOwnClaimant(tx: Prisma.TransactionClient, companyId: string, actor: ExpenseActor): Promise<{ id: string }> {
  const existing = await tx.expenseClaimant.findFirst({ where: { companyId, userId: actor.userId }, select: { id: true } })
  if (existing) return existing
  await assertMemberOfCompany(tx, companyId, actor.userId).catch((error) => {
    // An instance administrator who is not a member has no claimant of their own.
    if (error instanceof NotFoundError) throw new ValidationError('Choisissez le bénéficiaire de la note de frais.')
    throw error
  })
  await lockClaimants(tx, companyId)
  const user = await tx.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } })
  return tx.expenseClaimant.create({
    data: {
      companyId,
      kind: 'EMPLOYEE',
      name: user?.name?.trim() || user?.email || actor.userName || 'Salarié',
      userId: actor.userId,
      auxiliaryAccountNumber: await nextAuxiliaryNumber(tx, companyId, 'EMPLOYEE'),
    },
    select: { id: true },
  })
}

/** People a claimant can be linked to: the persons of the company and its members. */
export async function listClaimantOptions(companyId: string) {
  const [persons, members] = await Promise.all([
    prisma.person.findMany({
      where: { OR: [{ companyId }, { shareholders: { some: { companyId } } }] },
      select: { id: true, firstName: true, name: true },
      orderBy: [{ name: 'asc' }, { firstName: 'asc' }],
      take: 500,
    }),
    prisma.member.findMany({
      where: { organization: { companyId } },
      select: { userId: true, user: { select: { name: true, email: true } } },
      take: 500,
    }),
  ])
  return {
    persons: persons.map((p) => ({ id: p.id, name: `${p.firstName} ${p.name}`.trim() })),
    members: members.map((m) => ({ userId: m.userId, name: m.user.name || m.user.email })),
  }
}
