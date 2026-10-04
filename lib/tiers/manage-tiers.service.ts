/**
 * Customers and suppliers (tiers) of a company: list, read, create, update,
 * delete.
 *
 * Invariants owned here:
 * - a tiers belongs to one company; every lookup is scoped by companyId, so
 *   another company's tiers is a 404 like a missing one;
 * - its auxiliary account number (FEC CompAuxNum) is unique in the company
 *   (database unique index): it is the key that ties the tiers to entry
 *   lines, lettering and the third-party balances; changing it never
 *   rewrites a posted line, so a tiers holding invoices keeps its number;
 * - SIREN and SIRET pass their Luhn check, a French VAT number its key
 *   (identifiers.ts);
 * - its payment terms stay within Code de commerce art. L441-10 (60 days,
 *   or 45 days end of month), like the company's (also a database check);
 * - its address is an address of the company (lib/addresses), deleted with
 *   the change that leaves it unused;
 * - a tiers with invoices is never deleted.
 */

import { Prisma, type TiersKind } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { createCompanyAddress, deleteAddressesIfUnused } from '@/lib/addresses/manage-addresses.service'
import { optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { paymentTermsErrors, type PaymentTerms } from '@/lib/reports/third-parties/payment-terms'
import { checkIdentifiers } from './identifiers'
import { auxiliaryNumberError, normalizeAuxiliaryNumber, accountCodeError, TIERS_KIND_LABELS } from './rules'

export const TIERS_NOT_FOUND = 'Tiers introuvable'

type Db = Prisma.TransactionClient | typeof prisma

const kindSchema = z.enum(['CUSTOMER', 'SUPPLIER'], { error: 'Choisissez client ou fournisseur' })

const addressSchema = z
  .object({
    street: z.string().trim().min(1, 'La rue est requise').max(200),
    street2: optionalText(200),
    postalCode: z.string().trim().min(1, 'Le code postal est requis').max(20),
    city: z.string().trim().min(1, 'La ville est requise').max(100),
    country: z.string().trim().toUpperCase().length(2, 'Le code pays compte 2 lettres (ISO 3166-1)').default('FR'),
  })
  .nullable()

const termsSchema = z
  .object({
    days: z.number({ error: 'Indiquez le délai en jours' }).int('Le délai est un nombre entier de jours').min(0).max(60),
    endOfMonth: z.boolean().default(false),
  })
  .nullable()

const fields = {
  name: z.string({ error: 'Le nom est requis' }).trim().min(1, 'Le nom est requis').max(200, '200 caractères au maximum'),
  siren: optionalText(20),
  siret: optionalText(20),
  vatNumber: optionalText(20),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Adresse e-mail invalide')
    .nullable()
    .optional(),
  auxiliaryAccountNumber: optionalText(17),
  collectiveAccountCode: optionalText(20),
  defaultAccountCode: optionalText(20),
  defaultVatRateBp: z.number().int().min(0).max(10000).nullable().optional(),
  paymentTerms: termsSchema.optional(),
  address: addressSchema.optional(),
  notes: optionalText(2000),
}

/** Body of POST /api/tiers. */
export const CreateTiersBodySchema = z.object({ kind: kindSchema, ...fields })
export type CreateTiersInput = z.infer<typeof CreateTiersBodySchema>

/** Body of PATCH /api/tiers/[id] (the kind never changes: the collective account would). */
export const UpdateTiersBodySchema = z.object({ ...fields, name: fields.name.optional() })
export type UpdateTiersInput = z.infer<typeof UpdateTiersBodySchema>

/** ?companyId=&kind=&search=&limit= */
export const ListTiersQuerySchema = z.object({
  kind: kindSchema.optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})
export type ListTiersQuery = z.infer<typeof ListTiersQuerySchema>

export const TIERS_SELECT = {
  id: true,
  kind: true,
  name: true,
  siren: true,
  siret: true,
  vatNumber: true,
  email: true,
  auxiliaryAccountNumber: true,
  collectiveAccountCode: true,
  defaultAccountCode: true,
  defaultVatRateBp: true,
  paymentTermsDays: true,
  paymentTermsEndOfMonth: true,
  qontoId: true,
  notes: true,
  address: { select: { id: true, street: true, street2: true, postalCode: true, city: true, country: true } },
  _count: { select: { invoices: true } },
} satisfies Prisma.TiersSelect

export type TiersRow = Prisma.TiersGetPayload<{ select: typeof TIERS_SELECT }>

/** Payment terms of a tiers, or null when it follows the company's. */
export function termsOfTiers(tiers: { paymentTermsDays: number | null; paymentTermsEndOfMonth: boolean | null }): PaymentTerms | null {
  return tiers.paymentTermsDays === null ? null : { days: tiers.paymentTermsDays, endOfMonth: tiers.paymentTermsEndOfMonth ?? false }
}

export async function listTiers(companyId: string, query: ListTiersQuery) {
  const term = query.search?.trim()
  const where: Prisma.TiersWhereInput = {
    companyId,
    ...(query.kind ? { kind: query.kind } : {}),
    ...(term
      ? {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { auxiliaryAccountNumber: { contains: term, mode: 'insensitive' } },
            { siren: { contains: term.replace(/\s/g, '') } },
            { vatNumber: { contains: term.replace(/\s/g, ''), mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.tiers.findMany({ where, select: TIERS_SELECT, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: query.limit }),
    prisma.tiers.count({ where }),
  ])
  return { tiers: rows, total, truncated: total > rows.length }
}

export async function getTiers(companyId: string, id: string, db: Db = prisma): Promise<TiersRow> {
  const tiers = await db.tiers.findFirst({ where: { id, companyId }, select: TIERS_SELECT })
  if (!tiers) throw new NotFoundError(TIERS_NOT_FOUND)
  return tiers
}

/**
 * Next free auxiliary number of a kind: C00001, C00002... for customers,
 * F00001... for suppliers, after the greatest number of that pattern.
 */
export async function nextAuxiliaryNumber(db: Db, companyId: string, kind: TiersKind): Promise<string> {
  const prefix = kind === 'CUSTOMER' ? 'C' : 'F'
  const rows = await db.$queryRaw<Array<{ max: string | null }>>`
    SELECT MAX("auxiliaryAccountNumber") AS max FROM "tiers"
    WHERE "companyId" = ${companyId} AND "auxiliaryAccountNumber" ~ ${`^${prefix}[0-9]{5}$`}`
  const current = rows[0]?.max ? Number(rows[0].max.slice(1)) : 0
  return `${prefix}${String(current + 1).padStart(5, '0')}`
}

interface CheckedFields {
  siren?: string | null
  siret?: string | null
  vatNumber?: string | null
  auxiliaryAccountNumber?: string
  collectiveAccountCode?: string | null
  defaultAccountCode?: string | null
  paymentTermsDays?: number | null
  paymentTermsEndOfMonth?: boolean | null
}

/** Normalizes and checks the fields of a create or update; throws a French 400 listing every problem. */
function checkFields(kind: TiersKind, input: Partial<CreateTiersInput>, current?: { siren: string | null; siret: string | null; vatNumber: string | null }): CheckedFields {
  const errors: string[] = []
  const out: CheckedFields = {}
  if (input.siren !== undefined || input.siret !== undefined || input.vatNumber !== undefined) {
    const ids = checkIdentifiers({
      siren: input.siren !== undefined ? input.siren : current?.siren,
      siret: input.siret !== undefined ? input.siret : current?.siret,
      vatNumber: input.vatNumber !== undefined ? input.vatNumber : current?.vatNumber,
    })
    errors.push(...ids.errors)
    Object.assign(out, ids.values)
  }
  if (input.auxiliaryAccountNumber) {
    const aux = normalizeAuxiliaryNumber(input.auxiliaryAccountNumber)
    const error = auxiliaryNumberError(aux)
    if (error) errors.push(error)
    out.auxiliaryAccountNumber = aux
  }
  if (input.collectiveAccountCode !== undefined) {
    const error = input.collectiveAccountCode ? accountCodeError(kind, 'collective', input.collectiveAccountCode) : null
    if (error) errors.push(error)
    out.collectiveAccountCode = input.collectiveAccountCode
  }
  if (input.defaultAccountCode !== undefined) {
    const error = input.defaultAccountCode ? accountCodeError(kind, 'line', input.defaultAccountCode) : null
    if (error) errors.push(error)
    out.defaultAccountCode = input.defaultAccountCode
  }
  if (input.paymentTerms !== undefined) {
    if (input.paymentTerms) errors.push(...paymentTermsErrors(input.paymentTerms))
    out.paymentTermsDays = input.paymentTerms?.days ?? null
    out.paymentTermsEndOfMonth = input.paymentTerms ? input.paymentTerms.endOfMonth : null
  }
  if (errors.length > 0) throw new ValidationError(errors.join(' '))
  return out
}

async function assertAuxiliaryFree(db: Db, companyId: string, aux: string, exceptId?: string) {
  const taken = await db.tiers.findFirst({
    where: { companyId, auxiliaryAccountNumber: aux, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true },
  })
  if (taken) throw new ConflictError(`Le compte auxiliaire ${aux} est déjà celui de ${taken.name} : choisissez-en un autre.`)
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const

/** Serializes the creations of one company (the next auxiliary number). */
async function lockCompanyTiers(tx: Prisma.TransactionClient, companyId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:tiers:${companyId}`}))`
}

export async function createTiers(
  companyId: string,
  input: CreateTiersInput & { qontoId?: string | null },
  options: { source?: string; db?: Prisma.TransactionClient } = {},
): Promise<TiersRow> {
  const checked = checkFields(input.kind, input)
  const run = async (tx: Prisma.TransactionClient) => {
    await lockCompanyTiers(tx, companyId)
    const aux = checked.auxiliaryAccountNumber ?? (await nextAuxiliaryNumber(tx, companyId, input.kind))
    await assertAuxiliaryFree(tx, companyId, aux)
    const address = input.address ? await createCompanyAddress(companyId, input.address, tx) : null
    const created = await tx.tiers.create({
      data: {
        companyId,
        kind: input.kind,
        name: input.name,
        siren: checked.siren ?? null,
        siret: checked.siret ?? null,
        vatNumber: checked.vatNumber ?? null,
        email: input.email || null,
        auxiliaryAccountNumber: aux,
        collectiveAccountCode: checked.collectiveAccountCode ?? null,
        defaultAccountCode: checked.defaultAccountCode ?? null,
        defaultVatRateBp: input.defaultVatRateBp ?? null,
        paymentTermsDays: checked.paymentTermsDays ?? null,
        paymentTermsEndOfMonth: checked.paymentTermsEndOfMonth ?? null,
        qontoId: input.qontoId ?? null,
        notes: input.notes ?? null,
        addressId: address?.id ?? null,
      },
      select: { id: true },
    })
    return getTiers(companyId, created.id, tx)
  }
  const tiers = options.db ? await run(options.db) : await prisma.$transaction(run, TX_OPTIONS)
  await writeAuditLog('info', `Tiers created: ${tiers.auxiliaryAccountNumber}`, {
    action: 'CREATE_TIERS',
    companyId,
    metadata: { tiersId: tiers.id, kind: tiers.kind, source: options.source ?? 'web' },
  })
  return tiers
}

export async function updateTiers(companyId: string, id: string, input: UpdateTiersInput, options: { source?: string } = {}): Promise<TiersRow> {
  const tiers = await prisma.$transaction(async (tx) => {
    const current = await tx.tiers.findFirst({
      where: { id, companyId },
      select: { id: true, kind: true, siren: true, siret: true, vatNumber: true, auxiliaryAccountNumber: true, addressId: true, _count: { select: { invoices: true } } },
    })
    if (!current) throw new NotFoundError(TIERS_NOT_FOUND)
    const checked = checkFields(current.kind, input, current)
    if (checked.auxiliaryAccountNumber && checked.auxiliaryAccountNumber !== current.auxiliaryAccountNumber) {
      if (current._count.invoices > 0) {
        throw new ConflictError(
          `Le compte auxiliaire de ce tiers porte déjà des factures : il reste ${current.auxiliaryAccountNumber}, car les écritures passées ne changent pas.`,
        )
      }
      await assertAuxiliaryFree(tx, companyId, checked.auxiliaryAccountNumber, id)
    }
    let addressId: string | null | undefined
    if (input.address !== undefined) addressId = input.address ? (await createCompanyAddress(companyId, input.address, tx)).id : null
    await tx.tiers.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...('siren' in checked ? { siren: checked.siren, siret: checked.siret, vatNumber: checked.vatNumber } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(checked.auxiliaryAccountNumber ? { auxiliaryAccountNumber: checked.auxiliaryAccountNumber } : {}),
        ...(checked.collectiveAccountCode !== undefined ? { collectiveAccountCode: checked.collectiveAccountCode } : {}),
        ...(checked.defaultAccountCode !== undefined ? { defaultAccountCode: checked.defaultAccountCode } : {}),
        ...(input.defaultVatRateBp !== undefined ? { defaultVatRateBp: input.defaultVatRateBp } : {}),
        ...(checked.paymentTermsDays !== undefined ? { paymentTermsDays: checked.paymentTermsDays, paymentTermsEndOfMonth: checked.paymentTermsEndOfMonth } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(addressId !== undefined ? { addressId } : {}),
      },
    })
    if (addressId !== undefined && current.addressId && current.addressId !== addressId) {
      await deleteAddressesIfUnused(tx, companyId, [current.addressId])
    }
    return getTiers(companyId, id, tx)
  }, TX_OPTIONS)
  await writeAuditLog('info', `Tiers updated: ${tiers.auxiliaryAccountNumber}`, {
    action: 'UPDATE_TIERS',
    companyId,
    metadata: { tiersId: id, source: options.source ?? 'web' },
  })
  return tiers
}

export async function deleteTiers(companyId: string, id: string): Promise<{ id: string }> {
  const deleted = await prisma.$transaction(async (tx) => {
    const current = await tx.tiers.findFirst({
      where: { id, companyId },
      select: { id: true, name: true, kind: true, auxiliaryAccountNumber: true, addressId: true, _count: { select: { invoices: true } } },
    })
    if (!current) throw new NotFoundError(TIERS_NOT_FOUND)
    if (current._count.invoices > 0) {
      throw new ConflictError(
        `${current.name} a des factures : un ${TIERS_KIND_LABELS[current.kind].toLowerCase()} qui porte des factures ne peut pas être supprimé.`,
      )
    }
    await tx.tiers.delete({ where: { id } })
    await deleteAddressesIfUnused(tx, companyId, [current.addressId])
    return current
  }, TX_OPTIONS)
  await writeAuditLog('info', `Tiers deleted: ${deleted.auxiliaryAccountNumber}`, {
    action: 'DELETE_TIERS',
    companyId,
    metadata: { tiersId: id },
  })
  return { id }
}
