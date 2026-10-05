/**
 * Invoices of a management fee period, through Kledg's invoice module
 * (lib/invoices/manage-invoices.service.ts), never through entries:
 *
 * - in the holding: one draft sales invoice per subsidiary (direction SALE,
 *   the subsidiary as customer tiers, one line on the convention's revenue
 *   account at its VAT rate), numbered in the convention's series
 *   <prefix>-<year>-<sequence> (CGI ann. II art. 242 nonies A, I, 1°: a
 *   unique number in a continuous chronological sequence; a separate series
 *   per prefix is allowed). The user posts it from Factures de vente, like
 *   any invoice: the entry goes through post-invoice.service.ts;
 * - in each subsidiary, on request: the same invoice as a draft purchase
 *   invoice (the holding as supplier, the convention's expense account). It
 *   is a proposal: nothing reaches the subsidiary's books until a user of
 *   the subsidiary posts it from its own Factures d'achat. It needs
 *   entries:create in the subsidiary, checked for every subsidiary before
 *   anything is written. Without that right, or without the option, the
 *   subsidiary records the invoice it receives itself (entry or Qonto import).
 *
 * Invariants owned here:
 * - amounts come from computeConventionFees, the same engine as the preview;
 * - one billing per convention, subsidiary and period (unique constraint): a
 *   retried generation completes what is missing and creates nothing twice;
 *   an invoiced billing is never recomputed (a recalculation never
 *   overwrites invoiced fees); a period overlapping an invoiced one is refused;
 * - the holding's side of a generation (overlap check, billings, sales
 *   invoices) runs in one transaction under a lock per convention, so two
 *   generations at once never invoice a subsidiary or a period twice
 *   (KLEDG-SEC-010);
 * - writes in a subsidiary run in its own row level security scope
 *   (inCompany): the holding's context never writes there.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError } from '@/lib/accounting/errors'
import { dayToDate } from '@/lib/accounting/entry-date'
import { calendarDay } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { createInvoice } from '@/lib/invoices/manage-invoices.service'
import { createTiers } from '@/lib/tiers/manage-tiers.service'
import { isValidSiren, isValidVatNumber } from '@/lib/tiers/identifiers'
import { calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { inCompany, type GroupAccess } from './access'
import { computeConventionFees, type ManagementFeeComputation, type SubsidiaryIdentity } from './compute-management-fees.service'
import { CONVENTION_NOT_FOUND, viewSubsidiaries, type Convention } from './manage-conventions.service'

type Db = Prisma.TransactionClient | typeof prisma

const TX_OPTIONS = { maxWait: 20_000, timeout: 60_000 } as const

/** Body of POST /api/management-fees/conventions/[id]/invoices. */
export const GenerateInvoicesBodySchema = z.object({
  periodStart: calendarDay('Date de début de période invalide'),
  periodEnd: calendarDay('Date de fin de période invalide'),
  /** Invoice date; the end of the period when absent. */
  issueDate: calendarDay('Date de facture invalide').optional(),
  /** Propose the purchase invoice to each subsidiary as a draft (entries:create in each). */
  purchaseDrafts: z.boolean().default(true),
})
export type GenerateInvoicesInput = z.infer<typeof GenerateInvoicesBodySchema>

interface Party {
  id: string
  name: string
  siren: string
  vatNumber: string | null
}

const tiersIdentifiers = (party: Party) => ({
  siren: isValidSiren(party.siren) ? party.siren : null,
  vatNumber: party.vatNumber && isValidVatNumber(party.vatNumber) ? party.vatNumber : null,
})

/** The tiers of `party` in the current company (found by SIREN), or a new one. */
async function ensureTiers(
  companyId: string,
  kind: 'CUSTOMER' | 'SUPPLIER',
  party: Party,
  defaults: { accountCode: string; vatRateBp: number },
  tx?: Prisma.TransactionClient,
): Promise<string> {
  const ids = tiersIdentifiers(party)
  // By SIREN; by name for a company whose SIREN does not pass the checksum (it is then not copied to the tiers).
  const existing = await (tx ?? prisma).tiers.findFirst({
    where: { companyId, kind, ...(ids.siren ? { siren: ids.siren } : { name: party.name, siren: null }) },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  if (existing) return existing.id
  const created = await createTiers(
    companyId,
    { kind, name: party.name, ...ids, defaultAccountCode: defaults.accountCode, defaultVatRateBp: defaults.vatRateBp },
    { source: 'management-fees', db: tx },
  )
  return created.id
}

/** Next number of the series <prefix>-<year>- among the company's sales invoices. */
async function nextInvoiceNumber(db: Db, companyId: string, prefix: string, year: string): Promise<string> {
  const stem = `${prefix}-${year}-`
  const rows = await db.invoice.findMany({ where: { companyId, direction: 'SALE', number: { startsWith: stem } }, select: { number: true }, take: 10_000 })
  const last = rows.reduce((max, r) => {
    const n = /^\d+$/.test(r.number.slice(stem.length)) ? Number(r.number.slice(stem.length)) : 0
    return Math.max(max, n)
  }, 0)
  return `${stem}${String(last + 1).padStart(3, '0')}`
}

function lineLabel(convention: Convention, start: string, end: string): string {
  return `Prestations de services (convention « ${convention.label} ») du ${formatIsoDateFr(start)} au ${formatIsoDateFr(end)}`.slice(0, 500)
}

/** Creates the holding's sales invoice in the series, in `tx`; retries with the next number when an invoice entered meanwhile took it. */
async function createSalesInvoice(
  tx: Prisma.TransactionClient,
  holdingId: string,
  convention: Convention,
  tiersId: string,
  amountCents: number,
  issueDate: string,
  period: { start: string; end: string },
) {
  for (let attempt = 0; ; attempt += 1) {
    const number = await nextInvoiceNumber(tx, holdingId, convention.invoicePrefix, issueDate.slice(0, 4))
    try {
      return await createInvoice(
        holdingId,
        {
          direction: 'SALE',
          tiersId,
          number,
          issueDate,
          typeCode: '380',
          label: convention.label,
          lines: [
            {
              label: lineLabel(convention, period.start, period.end),
              quantity: '1',
              unitPriceCents: amountCents,
              vatRateBp: convention.vatRateBp,
              accountCode: convention.revenueAccountCode,
              nature: 'SERVICES',
              fixedAsset: false,
            },
          ],
        },
        { source: 'management-fees', db: tx },
      )
    } catch (error) {
      const taken = error instanceof ConflictError && (await tx.invoice.findFirst({ where: { companyId: holdingId, direction: 'SALE', number }, select: { id: true } }))
      if (!taken || attempt >= 4) throw error
    }
  }
}

/**
 * Inside the subsidiary's scope: its draft purchase invoice of the same
 * number (found again on a retry). One transaction under a lock per
 * subsidiary, so two generations at once find the supplier and the invoice
 * the other recorded instead of creating them twice (KLEDG-SEC-010).
 */
async function proposePurchaseInvoice(subsidiaryId: string, holding: Party, convention: Convention, number: string, amountCents: number, issueDate: string, period: { start: string; end: string }): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:management-fee-purchase:${subsidiaryId}`}))`
    const supplierId = await ensureTiers(subsidiaryId, 'SUPPLIER', holding, { accountCode: convention.expenseAccountCode, vatRateBp: convention.vatRateBp }, tx)
    const existing = await tx.invoice.findFirst({ where: { companyId: subsidiaryId, direction: 'PURCHASE', tiersId: supplierId, number }, select: { id: true } })
    if (existing) return existing.id
    const invoice = await createInvoice(
      subsidiaryId,
      {
        direction: 'PURCHASE',
        tiersId: supplierId,
        number,
        issueDate,
        typeCode: '380',
        label: convention.label,
        lines: [
          {
            label: lineLabel(convention, period.start, period.end),
            quantity: '1',
            unitPriceCents: amountCents,
            vatRateBp: convention.vatRateBp,
            accountCode: convention.expenseAccountCode,
            nature: 'SERVICES',
            fixedAsset: false,
          },
        ],
      },
      { source: 'management-fees', db: tx },
    )
    return invoice.id
  }, TX_OPTIONS)
}

export interface GeneratedBilling {
  billingId: string
  subsidiaryId: string
  name: string
  amountExclTaxCents: number
  vatCents: number
  amountInclTaxCents: number
  salesInvoice: { id: string; number: string }
  purchaseInvoiceId: string | null
  /** created: invoiced now; existing: invoiced by an earlier generation (amounts unchanged). */
  outcome: 'created' | 'existing'
}

const BILLING_KEY = (conventionId: string, subsidiaryId: string, start: string, end: string) => ({
  conventionId_subsidiaryId_periodStart_periodEnd: { conventionId, subsidiaryId, periodStart: dayToDate(start), periodEnd: dayToDate(end) },
})

/** Refuses a period overlapping an invoiced billing of another period (double invoicing). */
async function assertNoOverlap(db: Db, holdingId: string, conventionId: string, start: string, end: string) {
  const overlapping = await db.managementFeeBilling.findMany({
    where: {
      companyId: holdingId,
      conventionId,
      salesInvoiceId: { not: null },
      periodStart: { lte: dayToDate(end) },
      periodEnd: { gte: dayToDate(start) },
      NOT: { periodStart: dayToDate(start), periodEnd: dayToDate(end) },
    },
    select: { periodStart: true, periodEnd: true, salesInvoice: { select: { number: true } } },
    take: 5,
  })
  if (overlapping.length > 0) {
    const first = overlapping[0]
    throw new ConflictError(
      `La période chevauche une période déjà facturée (du ${formatIsoDateFr(calendarDayOf(first.periodStart) as string)} au ${formatIsoDateFr(calendarDayOf(first.periodEnd) as string)}, facture ${first.salesInvoice?.number ?? ''}) : choisissez une période qui ne recoupe aucune facture.`,
    )
  }
}

const BILLING_SELECT = {
  id: true,
  amountExclTax: true,
  vatAmount: true,
  amountInclTax: true,
  salesInvoiceId: true,
  purchaseInvoiceId: true,
  salesInvoice: { select: { id: true, number: true, issueDate: true } },
} satisfies Prisma.ManagementFeeBillingSelect

type BillingRow = Prisma.ManagementFeeBillingGetPayload<{ select: typeof BILLING_SELECT }>

/**
 * Serializes the holding's side of the generations of one convention
 * (KLEDG-SEC-010): two generations at once used to pass the overlap check
 * and the billing lookup together, then both invoiced the same subsidiary,
 * or two overlapping periods. Taken first in the transaction that records
 * the sales invoices, then the state is read again.
 */
async function lockConventionBillings(tx: Prisma.TransactionClient, conventionId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:management-fee-billing:${conventionId}`}))`
}

/**
 * Invoices the period: the holding's sales invoices and, on request, the
 * subsidiaries' draft purchase invoices. Returns one billing per subsidiary
 * with a fee.
 */
export async function generateManagementFeeInvoices(
  holdingId: string,
  conventionId: string,
  input: GenerateInvoicesInput,
  access: GroupAccess,
): Promise<{ billings: GeneratedBilling[] }> {
  // Before computing: an overlap is the first thing to tell, whatever the books say now
  // (checked again under the lock below).
  await assertNoOverlap(prisma, holdingId, conventionId, input.periodStart, input.periodEnd)
  const computation = await computeConventionFees(holdingId, conventionId, { periodStart: input.periodStart, periodEnd: input.periodEnd }, access)
  const { convention, result } = computation
  const period = computation.period
  const issueDate = input.issueDate ?? period.end
  const parts = result.parts.filter((p) => p.amountExclTaxCents > 0)
  const identities = new Map<string, SubsidiaryIdentity>(computation.subsidiaries.map((s) => [s.id, s]))
  const complete = (billing: { salesInvoiceId: string | null; purchaseInvoiceId: string | null } | undefined) =>
    Boolean(billing?.salesInvoiceId && (!input.purchaseDrafts || billing.purchaseInvoiceId))

  // Every right is checked before the first write: a refusal in one
  // subsidiary leaves nothing half done.
  if (input.purchaseDrafts) {
    for (const part of parts) await inCompany(access, part.subsidiaryId, { entries: ['create'] }, async () => undefined)
  }

  const holding = await prisma.company.findUnique({ where: { id: holdingId }, select: { id: true, name: true, siren: true, vatNumber: true } })
  if (!holding) throw new NotFoundError('Société introuvable')

  // The holding's side, in one transaction under the convention's lock: the
  // overlap and the billings are read again there, so a concurrent
  // generation finds what this one recorded.
  const recorded = await prisma.$transaction(async (tx) => {
    await lockConventionBillings(tx, conventionId)
    await assertNoOverlap(tx, holdingId, conventionId, period.start, period.end)
    const existing = await tx.managementFeeBilling.findMany({
      where: { companyId: holdingId, conventionId, periodStart: dayToDate(period.start), periodEnd: dayToDate(period.end) },
      select: { subsidiaryId: true, salesInvoiceId: true, purchaseInvoiceId: true },
    })
    const existingBySubsidiary = new Map(existing.map((b) => [b.subsidiaryId, b]))
    if (parts.every((p) => complete(existingBySubsidiary.get(p.subsidiaryId)))) {
      throw new ConflictError('Cette période est déjà facturée pour toutes les filiales de la convention.')
    }
    const rows: Array<{ part: (typeof parts)[number]; billing: BillingRow; outcome: GeneratedBilling['outcome'] }> = []
    for (const part of parts) {
      const subsidiary = identities.get(part.subsidiaryId) as SubsidiaryIdentity
      const key = BILLING_KEY(conventionId, part.subsidiaryId, period.start, period.end)
      let billing = await tx.managementFeeBilling.findUnique({ where: key, select: BILLING_SELECT })
      const outcome: GeneratedBilling['outcome'] = billing?.salesInvoiceId ? 'existing' : 'created'
      if (!billing?.salesInvoiceId) {
        const amounts = {
          amountExclTax: centsToDecimal(part.amountExclTaxCents),
          vatRateBp: convention.vatRateBp,
          vatAmount: centsToDecimal(part.vatCents),
          amountInclTax: centsToDecimal(part.amountInclTaxCents),
          details: billingDetails(computation, part.subsidiaryId) as Prisma.InputJsonValue,
        }
        const row = billing
          ? await tx.managementFeeBilling.update({ where: { id: billing.id }, data: amounts, select: { id: true } })
          : await tx.managementFeeBilling.create({
              data: { companyId: holdingId, conventionId, subsidiaryId: part.subsidiaryId, periodStart: dayToDate(period.start), periodEnd: dayToDate(period.end), createdById: access.userId, ...amounts },
              select: { id: true },
            })
        const customerId = await ensureTiers(holdingId, 'CUSTOMER', subsidiary, { accountCode: convention.revenueAccountCode, vatRateBp: convention.vatRateBp }, tx)
        const invoice = await createSalesInvoice(tx, holdingId, convention, customerId, part.amountExclTaxCents, issueDate, period)
        billing = await tx.managementFeeBilling.update({ where: { id: row.id }, data: { salesInvoiceId: invoice.id }, select: BILLING_SELECT })
      }
      rows.push({ part, billing, outcome })
    }
    return rows
  }, TX_OPTIONS)

  const billings: GeneratedBilling[] = []
  for (const { part, billing, outcome } of recorded) {
    const subsidiary = identities.get(part.subsidiaryId) as SubsidiaryIdentity
    const sales = billing.salesInvoice as { id: string; number: string; issueDate: Date }
    const amountExclTaxCents = parseCents(billing.amountExclTax) ?? 0
    let purchaseInvoiceId = billing.purchaseInvoiceId
    if (input.purchaseDrafts && !purchaseInvoiceId) {
      const salesDay = calendarDayOf(sales.issueDate) as string
      purchaseInvoiceId = await inCompany(access, part.subsidiaryId, { entries: ['create'] }, () =>
        proposePurchaseInvoice(part.subsidiaryId, holding, convention, sales.number, amountExclTaxCents, salesDay, period),
      )
      await prisma.managementFeeBilling.update({ where: { id: billing.id }, data: { purchaseInvoiceId } })
    }
    billings.push({
      billingId: billing.id,
      subsidiaryId: part.subsidiaryId,
      name: subsidiary.name,
      amountExclTaxCents,
      vatCents: parseCents(billing.vatAmount) ?? 0,
      amountInclTaxCents: parseCents(billing.amountInclTax) ?? 0,
      salesInvoice: { id: sales.id, number: sales.number },
      purchaseInvoiceId,
      outcome,
    })
  }

  await writeAuditLog('info', `Management fees invoiced: ${convention.label}, ${period.start} to ${period.end}`, {
    action: 'GENERATE_MANAGEMENT_FEE_INVOICES',
    companyId: holdingId,
    metadata: {
      conventionId,
      periodStart: period.start,
      periodEnd: period.end,
      billingIds: billings.map((b) => b.billingId),
      purchaseDrafts: input.purchaseDrafts,
    },
  })
  return { billings }
}

/** What the billing records of the computation, for the transfer pricing file (amounts in cents). */
function billingDetails(computation: ManagementFeeComputation, subsidiaryId: string) {
  const { result, costPool, convention } = computation
  const part = result.parts.find((p) => p.subsidiaryId === subsidiaryId)
  return {
    pricing: result.pricing,
    allocationKey: result.allocationKey,
    costPoolCents: result.costPoolCents,
    costShareBp: result.costShareBp,
    markupBp: result.markupBp,
    baseCents: result.baseCents,
    markupCents: result.markupCents,
    totalExclTaxCents: result.totalExclTaxCents,
    costAccounts: costPool?.accounts.map((a) => ({ code: a.code, cents: a.cents })) ?? [],
    costAccountPrefixes: convention.costAccountPrefixes,
    excludedAccountPrefixes: convention.excludedAccountPrefixes,
    weights: result.parts.map((p) => ({ subsidiaryId: p.subsidiaryId, weight: p.weight, eligibleDays: p.eligibleDays, revenueCents: p.revenueCents, sharePercentBp: p.sharePercentBp })),
    part: part ? { weight: part.weight, eligibleDays: part.eligibleDays, revenueCents: part.revenueCents } : null,
  }
}

export interface BillingView {
  id: string
  subsidiaryId: string
  subsidiaryName: string | null
  periodStart: string
  periodEnd: string
  amountExclTaxCents: number
  vatRateBp: number
  vatCents: number
  amountInclTaxCents: number
  salesInvoice: { id: string; number: string; posted: boolean } | null
  /** unknown: the user cannot read the subsidiary's invoices. */
  purchaseInvoice: { id: string; number: string; posted: boolean } | 'unknown' | null
  createdAt: string
}

/** Billings of a convention, newest period first (subsidiaries in the order invoiced), with the state of their invoices on both sides. */
export async function listBillings(holdingId: string, conventionId: string, access: GroupAccess): Promise<BillingView[]> {
  const convention = await prisma.managementFeeConvention.findFirst({ where: { id: conventionId, companyId: holdingId }, select: { id: true } })
  if (!convention) throw new NotFoundError(CONVENTION_NOT_FOUND)
  const rows = await prisma.managementFeeBilling.findMany({
    where: { companyId: holdingId, conventionId },
    select: {
      id: true,
      subsidiaryId: true,
      periodStart: true,
      periodEnd: true,
      amountExclTax: true,
      vatRateBp: true,
      vatAmount: true,
      amountInclTax: true,
      purchaseInvoiceId: true,
      createdAt: true,
      salesInvoice: { select: { id: true, number: true, entryId: true } },
    },
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'asc' }],
    take: 500,
  })
  const names = await viewSubsidiaries(access, rows.map((r) => r.subsidiaryId))
  // The purchase invoices live in the subsidiaries: read in each one's scope, with entries:read there.
  const purchases = new Map<string, { id: string; number: string; posted: boolean } | 'unknown'>()
  const bySubsidiary = new Map<string, string[]>()
  for (const row of rows) {
    if (row.purchaseInvoiceId) bySubsidiary.set(row.subsidiaryId, [...(bySubsidiary.get(row.subsidiaryId) ?? []), row.purchaseInvoiceId])
  }
  for (const [subsidiaryId, ids] of bySubsidiary) {
    const found = await inCompany(access, subsidiaryId, { entries: ['read'] }, () =>
      prisma.invoice.findMany({ where: { companyId: subsidiaryId, id: { in: ids } }, select: { id: true, number: true, entryId: true } }),
    ).catch(() => null)
    for (const id of ids) {
      const invoice = found?.find((i) => i.id === id)
      purchases.set(id, found === null ? 'unknown' : invoice ? { id: invoice.id, number: invoice.number, posted: invoice.entryId !== null } : 'unknown')
    }
  }
  return rows.map((r) => ({
    id: r.id,
    subsidiaryId: r.subsidiaryId,
    subsidiaryName: names.get(r.subsidiaryId)?.name ?? null,
    periodStart: calendarDayOf(r.periodStart) as string,
    periodEnd: calendarDayOf(r.periodEnd) as string,
    amountExclTaxCents: parseCents(r.amountExclTax) ?? 0,
    vatRateBp: r.vatRateBp,
    vatCents: parseCents(r.vatAmount) ?? 0,
    amountInclTaxCents: parseCents(r.amountInclTax) ?? 0,
    salesInvoice: r.salesInvoice ? { id: r.salesInvoice.id, number: r.salesInvoice.number, posted: r.salesInvoice.entryId !== null } : null,
    purchaseInvoice: r.purchaseInvoiceId ? (purchases.get(r.purchaseInvoiceId) ?? 'unknown') : null,
    createdAt: r.createdAt.toISOString(),
  }))
}
