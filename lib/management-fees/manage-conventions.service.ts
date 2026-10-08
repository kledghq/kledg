/**
 * Management fee conventions of a holding: list, read, create, update,
 * delete. Used by /api/management-fees/conventions and the MCP tools.
 *
 * Invariants owned here:
 * - a convention belongs to the holding of the request (every lookup is
 *   scoped by its companyId; another company's convention is a 404);
 * - each subsidiary is a company that records the holding among its
 *   shareholders (lib/management-fees/holding.ts) and that the user may read
 *   (reports:read in it, lib/management-fees/access.ts), checked on every
 *   write;
 * - custom shares add up to exactly 100 % (10 000 basis points); the VAT
 *   rate is a French rate, 0 % when the holding is under the VAT franchise
 *   (CGI art. 293 B); the revenue account is a class 7 account and the
 *   expense account a class 6 one;
 * - a convention already invoiced is never deleted (its billings are the
 *   audit trail of the invoices); end it with an end date instead.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { dayToDate } from '@/lib/accounting/entry-date'
import { calendarDay, optionalCalendarDay, optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { formatVatRate, isFrenchVatRate } from '@/lib/invoices/amounts'
import { accountCodeError } from '@/lib/tiers/rules'
import { calendarDayOf } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { inCompany, type GroupAccess } from './access'
import { assertSubsidiaryOf } from './holding'
import { isAccountCode } from '@/lib/accounting/account-code'
import {
  DEFAULT_COST_PREFIXES,
  DEFAULT_EXCLUDED_PREFIXES,
  DEFAULT_EXPENSE_ACCOUNT,
  DEFAULT_INVOICE_PREFIX,
  DEFAULT_REVENUE_ACCOUNT,
} from './rules'

export const CONVENTION_NOT_FOUND = 'Convention introuvable'

const prefixList = z
  .array(z.string().trim().regex(/^[0-9]{1,8}$/, 'Un préfixe de compte ne contient que des chiffres (ex. 6, 625).'))
  .max(50, '50 préfixes au plus')

const subsidiarySchema = z.object({
  subsidiaryId: z.string({ error: 'Choisissez la filiale' }).min(1, 'Choisissez la filiale').max(64),
  sharePercentBp: z.number().int().min(0).max(10000).nullish(),
  startDate: optionalCalendarDay('Date d’entrée invalide'),
  endDate: optionalCalendarDay('Date de sortie invalide'),
})

/** Body of POST /api/management-fees/conventions and PATCH /api/management-fees/conventions/[id] (the whole convention). */
export const ConventionBodySchema = z.object({
  label: z.string({ error: 'Le nom de la convention est requis' }).trim().min(1, 'Le nom de la convention est requis').max(200),
  pricing: z.enum(['COST_PLUS', 'FIXED']).default('COST_PLUS'),
  markupBp: z.number().int().min(0, 'La marge ne peut pas être négative').max(10000, 'La marge est de 100 % au plus').default(500),
  costShareBp: z.number().int().min(1, 'La part des charges refacturables est positive').max(10000, 'La part des charges refacturables est de 100 % au plus').default(10000),
  costAccountPrefixes: prefixList.min(1, 'Indiquez au moins un compte de charges (ex. 6)').default([...DEFAULT_COST_PREFIXES]),
  excludedAccountPrefixes: prefixList.default(DEFAULT_EXCLUDED_PREFIXES.map((e) => e.prefix)),
  fixedAmountCents: z.number().int('Montant en centimes').positive('Le montant forfaitaire est positif').max(1e13).nullish(),
  allocationKey: z.enum(['EQUAL', 'REVENUE', 'CUSTOM']).default('EQUAL'),
  vatRateBp: z.number().int().min(0).max(10000).default(2000),
  revenueAccountCode: z.string().trim().min(1).max(20).default(DEFAULT_REVENUE_ACCOUNT),
  expenseAccountCode: z.string().trim().min(1).max(20).default(DEFAULT_EXPENSE_ACCOUNT),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,10}$/, 'Le préfixe des factures compte 1 à 10 lettres ou chiffres (ex. FG).')
    .default(DEFAULT_INVOICE_PREFIX),
  startDate: calendarDay('Date de début invalide'),
  endDate: optionalCalendarDay('Date de fin invalide'),
  notes: optionalText(2000),
  subsidiaries: z.array(subsidiarySchema, { error: 'Ajoutez au moins une filiale' }).min(1, 'Ajoutez au moins une filiale').max(50, '50 filiales au plus'),
})
export type ConventionInput = z.infer<typeof ConventionBodySchema>

const CONVENTION_SELECT = {
  id: true,
  companyId: true,
  label: true,
  pricing: true,
  markupBp: true,
  costShareBp: true,
  costAccountPrefixes: true,
  excludedAccountPrefixes: true,
  fixedAmount: true,
  allocationKey: true,
  vatRateBp: true,
  revenueAccountCode: true,
  expenseAccountCode: true,
  invoicePrefix: true,
  startDate: true,
  endDate: true,
  notes: true,
  createdAt: true,
  subsidiaries: { orderBy: { position: 'asc' }, select: { subsidiaryId: true, sharePercentBp: true, startDate: true, endDate: true } },
  _count: { select: { billings: true } },
} satisfies Prisma.ManagementFeeConventionSelect

type ConventionRow = Prisma.ManagementFeeConventionGetPayload<{ select: typeof CONVENTION_SELECT }>

/** A convention as stored, dates as ISO days, amounts in cents. */
export interface Convention {
  id: string
  label: string
  pricing: 'COST_PLUS' | 'FIXED'
  markupBp: number
  costShareBp: number
  costAccountPrefixes: string[]
  excludedAccountPrefixes: string[]
  fixedAmountCents: number | null
  allocationKey: 'EQUAL' | 'REVENUE' | 'CUSTOM'
  vatRateBp: number
  revenueAccountCode: string
  expenseAccountCode: string
  invoicePrefix: string
  startDate: string
  endDate: string | null
  notes: string | null
  billingCount: number
  subsidiaries: Array<{ subsidiaryId: string; sharePercentBp: number | null; startDate: string | null; endDate: string | null }>
}

function conventionOf(row: ConventionRow): Convention {
  return {
    id: row.id,
    label: row.label,
    pricing: row.pricing,
    markupBp: row.markupBp,
    costShareBp: row.costShareBp,
    costAccountPrefixes: row.costAccountPrefixes,
    excludedAccountPrefixes: row.excludedAccountPrefixes,
    fixedAmountCents: row.fixedAmount === null ? null : parseCents(row.fixedAmount),
    allocationKey: row.allocationKey,
    vatRateBp: row.vatRateBp,
    revenueAccountCode: row.revenueAccountCode,
    expenseAccountCode: row.expenseAccountCode,
    invoicePrefix: row.invoicePrefix,
    startDate: calendarDayOf(row.startDate) as string,
    endDate: calendarDayOf(row.endDate),
    notes: row.notes,
    billingCount: row._count.billings,
    subsidiaries: row.subsidiaries.map((s) => ({
      subsidiaryId: s.subsidiaryId,
      sharePercentBp: s.sharePercentBp,
      startDate: calendarDayOf(s.startDate),
      endDate: calendarDayOf(s.endDate),
    })),
  }
}

/** A convention of the holding (the current scope), or a 404. */
export async function loadConvention(holdingId: string, id: string): Promise<Convention> {
  const row = await prisma.managementFeeConvention.findFirst({ where: { id, companyId: holdingId }, select: CONVENTION_SELECT })
  if (!row) throw new NotFoundError(CONVENTION_NOT_FOUND)
  return conventionOf(row)
}

export interface SubsidiaryView {
  subsidiaryId: string
  /** Null when the user cannot read the subsidiary (no longer a member). */
  name: string | null
  accessible: boolean
}

/** Names of the subsidiaries the user may read; the others are only flagged (their names are not the holding's data). */
export async function viewSubsidiaries(access: GroupAccess, ids: readonly string[]): Promise<Map<string, SubsidiaryView>> {
  const views = new Map<string, SubsidiaryView>()
  for (const subsidiaryId of new Set(ids)) {
    const name = await inCompany(access, subsidiaryId, { reports: ['read'] }, async () => {
      const company = await prisma.company.findUnique({ where: { id: subsidiaryId }, select: { name: true } })
      return company?.name ?? null
    }).catch(() => null)
    views.set(subsidiaryId, { subsidiaryId, name, accessible: name !== null })
  }
  return views
}

export async function listConventions(holdingId: string, access: GroupAccess) {
  const rows = await prisma.managementFeeConvention.findMany({
    where: { companyId: holdingId },
    select: CONVENTION_SELECT,
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  })
  const conventions = rows.map(conventionOf)
  const views = await viewSubsidiaries(access, conventions.flatMap((c) => c.subsidiaries.map((s) => s.subsidiaryId)))
  return conventions.map((c) => ({ ...c, subsidiaries: c.subsidiaries.map((s) => ({ ...s, ...views.get(s.subsidiaryId)! })) }))
}

/** A convention with the names of the subsidiaries the user may read. */
export async function getConvention(holdingId: string, id: string, access: GroupAccess) {
  const convention = await loadConvention(holdingId, id)
  const views = await viewSubsidiaries(access, convention.subsidiaries.map((s) => s.subsidiaryId))
  return { ...convention, subsidiaries: convention.subsidiaries.map((s) => ({ ...s, ...views.get(s.subsidiaryId)! })) }
}

/** Checks of a convention that need no subsidiary: one French 400 listing every problem. */
async function checkConvention(holdingId: string, input: ConventionInput): Promise<void> {
  const errors: string[] = []
  const holding = await prisma.company.findUnique({ where: { id: holdingId }, select: { isVatExempt: true } })
  if (!isFrenchVatRate(input.vatRateBp)) errors.push(`${formatVatRate(input.vatRateBp)} n’est pas un taux de TVA français.`)
  if (holding?.isVatExempt && input.vatRateBp !== 0) {
    errors.push('La holding bénéficie de la franchise en base de TVA (CGI art. 293 B) : ses factures sont sans TVA, choisissez 0 %.')
  }
  const revenueError = accountCodeError('CUSTOMER', 'line', input.revenueAccountCode)
  if (revenueError) errors.push(revenueError)
  if (!isAccountCode(input.expenseAccountCode) || !input.expenseAccountCode.startsWith('6')) {
    errors.push('Le compte de charges des filiales est un compte de classe 6 (ex. 6226 honoraires, 6228 divers).')
  }
  if (input.pricing === 'FIXED' && !input.fixedAmountCents) errors.push('Indiquez le montant forfaitaire hors taxes de chaque période.')
  if (input.endDate && input.endDate < input.startDate) errors.push('La fin de la convention ne peut pas précéder son début.')
  const ids = input.subsidiaries.map((s) => s.subsidiaryId)
  if (new Set(ids).size !== ids.length) errors.push('Une filiale figure deux fois dans la convention.')
  if (ids.includes(holdingId)) errors.push('Une société ne peut pas être sa propre filiale.')
  for (const s of input.subsidiaries) {
    if (s.startDate && s.endDate && s.endDate < s.startDate) errors.push('La date de sortie d’une filiale précède sa date d’entrée.')
  }
  if (input.allocationKey === 'CUSTOM') {
    if (input.subsidiaries.some((s) => s.sharePercentBp === null || s.sharePercentBp === undefined)) {
      errors.push('Avec des pourcentages fixés, indiquez la part de chaque filiale.')
    } else {
      const total = input.subsidiaries.reduce((sum, s) => sum + (s.sharePercentBp ?? 0), 0)
      if (total !== 10000) errors.push(`Les parts des filiales totalisent ${formatVatRate(total)} : elles doivent faire exactement 100 %.`)
    }
  }
  if (errors.length > 0) throw new ValidationError(errors.join(' '))
}

/** Every subsidiary records the holding as a shareholder and is readable by the user, each in its own scope. */
async function checkSubsidiaries(holdingId: string, input: ConventionInput, access: GroupAccess): Promise<void> {
  for (const s of input.subsidiaries) {
    await inCompany(access, s.subsidiaryId, { reports: ['read'] }, () => assertSubsidiaryOf(holdingId, s.subsidiaryId))
  }
}

function conventionData(input: ConventionInput) {
  return {
    label: input.label,
    pricing: input.pricing,
    markupBp: input.pricing === 'FIXED' ? 0 : input.markupBp,
    costShareBp: input.costShareBp,
    costAccountPrefixes: [...new Set(input.costAccountPrefixes)],
    excludedAccountPrefixes: [...new Set(input.excludedAccountPrefixes)],
    fixedAmount: input.pricing === 'FIXED' && input.fixedAmountCents ? centsToDecimal(input.fixedAmountCents) : null,
    allocationKey: input.allocationKey,
    vatRateBp: input.vatRateBp,
    revenueAccountCode: input.revenueAccountCode,
    expenseAccountCode: input.expenseAccountCode,
    invoicePrefix: input.invoicePrefix,
    startDate: dayToDate(input.startDate),
    endDate: input.endDate ? dayToDate(input.endDate) : null,
    notes: input.notes ?? null,
  }
}

function subsidiaryRows(input: ConventionInput) {
  return input.subsidiaries.map((s, position) => ({
    subsidiaryId: s.subsidiaryId,
    sharePercentBp: input.allocationKey === 'CUSTOM' ? (s.sharePercentBp ?? 0) : null,
    startDate: s.startDate ? dayToDate(s.startDate) : null,
    endDate: s.endDate ? dayToDate(s.endDate) : null,
    position,
  }))
}

export async function createConvention(holdingId: string, input: ConventionInput, access: GroupAccess): Promise<Convention> {
  await checkConvention(holdingId, input)
  await checkSubsidiaries(holdingId, input, access)
  const created = await prisma.managementFeeConvention.create({
    data: { companyId: holdingId, ...conventionData(input), subsidiaries: { create: subsidiaryRows(input) } },
    select: { id: true },
  })
  await writeAuditLog('info', `Management fee convention created: ${input.label}`, {
    action: 'CREATE_MANAGEMENT_FEE_CONVENTION',
    companyId: holdingId,
    metadata: { conventionId: created.id, subsidiaryIds: input.subsidiaries.map((s) => s.subsidiaryId) },
  })
  return loadConvention(holdingId, created.id)
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const

/**
 * Replaces the convention. Past billings keep the amounts they were invoiced
 * with (their details), whatever changes here.
 */
export async function updateConvention(holdingId: string, id: string, input: ConventionInput, access: GroupAccess): Promise<Convention> {
  await loadConvention(holdingId, id)
  await checkConvention(holdingId, input)
  await checkSubsidiaries(holdingId, input, access)
  await prisma.$transaction(async (tx) => {
    await tx.managementFeeSubsidiary.deleteMany({ where: { conventionId: id } })
    await tx.managementFeeConvention.update({ where: { id }, data: { ...conventionData(input), subsidiaries: { create: subsidiaryRows(input) } } })
  }, TX_OPTIONS)
  await writeAuditLog('info', `Management fee convention updated: ${input.label}`, {
    action: 'UPDATE_MANAGEMENT_FEE_CONVENTION',
    companyId: holdingId,
    metadata: { conventionId: id, subsidiaryIds: input.subsidiaries.map((s) => s.subsidiaryId) },
  })
  return loadConvention(holdingId, id)
}

export async function deleteConvention(holdingId: string, id: string): Promise<{ id: string }> {
  const convention = await loadConvention(holdingId, id)
  if (convention.billingCount > 0) {
    throw new ConflictError(
      `La convention « ${convention.label} » a déjà été facturée : elle reste la référence de ses factures. Indiquez plutôt une date de fin.`,
    )
  }
  await prisma.managementFeeConvention.delete({ where: { id } })
  await writeAuditLog('info', `Management fee convention deleted: ${convention.label}`, {
    action: 'DELETE_MANAGEMENT_FEE_CONVENTION',
    companyId: holdingId,
    metadata: { conventionId: id },
  })
  return { id }
}
