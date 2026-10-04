/**
 * The VAT return worksheet of a period (docs/declarations-tva.md): Kledg
 * computes the CA3 or the CA12 from the validated entries, the user checks
 * it and files it on impots.gouv.fr. Kledg never files a return.
 *
 * Loads, in bounded queries scoped by the company:
 * - the regimes, settings and fiscal years of the deadline calendar
 *   (lib/deadlines), which decide the form and the periods;
 * - the validated entries dated in the period, their lines and, for sales
 *   invoices posted by Kledg, the invoice lines and VAT breakdown;
 * - the VAT balances before the period (credit carried on 44567, 4455 and
 *   the other VAT accounts for the checks);
 * - the drafts and bank lines of the period, the settlement entry already
 *   prepared and the filings recorded;
 * then runs the pure modules: classify.ts, compute.ts, checks.ts.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, ValidationError } from '@/lib/accounting/errors'
import { transactionOfCompany } from '@/lib/api/resources'
import { computeDeadlines } from '@/lib/deadlines/engine'
import { loadDeadlineContext, type CompanyContext } from '@/lib/deadlines/load-deadlines.service'
import { addIsoDays, calendarDayOf, todayUtc } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import {
  classifyEntries,
  isAcompteCode,
  isAutoliquidationCode,
  isBalanceEntry,
  isCollectedCode,
  isCreditCarriedCode,
  isDeductibleFixedAssetsCode,
  isDeductibleOtherCode,
  isSettlementEntry,
  isToPayCode,
  type VatEntry,
  type VatInvoiceSource,
  type VatMovements,
} from './classify'
import { computeVatReturn, type VatReturnComputation } from './compute'
import { isReliable, vatChecks, type BalanceRow, type VatCheck } from './checks'
import { FORM_TITLES, NOT_FROM_THE_BOOKS, VAT_SOURCES, type VatSource } from './forms'
import { deadlineIdOfPeriod, listPeriods, periodOfKey, periodOfMonth, PERIOD_KEY_PATTERN, previousPeriodKey, type VatPeriod } from './periods'
import { settlementReference } from './settlement'

/** Entries of one period read at most: a small company books a few hundred a month. */
const MAX_PERIOD_ENTRIES = 20_000
/** Periods offered in the selector, most recent first (five years of monthly returns). */
const MAX_PERIODS = 60
const DRAFT_NUMBERS_SHOWN = 10

export const VatReturnQuerySchema = z.object({
  period: z.string().regex(PERIOD_KEY_PATTERN, 'Période invalide : aaaa-mm, aaaa-Tn ou aaaa.').optional(),
})
export type VatReturnQuery = z.infer<typeof VatReturnQuerySchema>

export interface VatReturnPeriodOption {
  id: string
  label: string
  form: VatPeriod['form']
  start: string
  end: string
  filed: boolean
}

export interface VatFilingRecord {
  filedOn: string
  amountDueCents: number
  creditCents: number
}

export interface VatReturnView {
  today: string
  /**
   * ready: a return computed; exempt: franchise en base or exemption, no
   * return; missing-regime: the VAT regime is not set; no-period: no
   * period to show yet (no fiscal year).
   */
  status: 'ready' | 'exempt' | 'missing-regime' | 'no-period'
  periods: VatReturnPeriodOption[]
  period: VatPeriod | null
  formTitle: string | null
  /** The deadline of the return in the calendar, when the calendar has it. */
  deadline: { date: string; legalDate: string; estimated: boolean; label: string } | null
  computation: VatReturnComputation | null
  checks: VatCheck[]
  /** No blocking check: the figures can be declared as computed. */
  reliable: boolean
  movements: Pick<VatMovements, 'entries' | 'pendingCollectedCents' | 'unidentified' | 'unhandled'> | null
  settlement: { reference: string; status: 'none' | 'draft' | 'validated'; entryId: string | null; entryNumber: string | null }
  filing: VatFilingRecord | null
  notFromTheBooks: string[]
  sources: VatSource[]
}

/** What the settlement service needs besides the view. */
export interface SettlementBasis {
  period: VatPeriod
  fiscalYear: { id: string; year: number; isClosed: boolean } | null
  periodNetByCode: Map<string, number>
  creditCarried: { cents: number; code: string }
  acomptes: { cents: number; code: string } | null
}

const day = (value: Date) => calendarDayOf(value) as string
const cents = (value: { toString(): string } | null | undefined) => parseCents(value ?? 0) ?? 0
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

type InvoiceRow = {
  direction: string
  lines: Array<{ vatRateBp: number; totalExclTax: { toString(): string }; nature: 'GOODS' | 'SERVICES' }>
  vatBreakdown: Array<{ vatRateBp: number; baseAmount: { toString(): string }; vatAmount: { toString(): string } }>
}

const INVOICE_SELECT = {
  direction: true,
  lines: { select: { vatRateBp: true, totalExclTax: true, nature: true } },
  vatBreakdown: { select: { vatRateBp: true, baseAmount: true, vatAmount: true } },
} as const

function invoiceSource(invoice: InvoiceRow | null | undefined): VatInvoiceSource | null {
  if (!invoice || invoice.direction !== 'SALE') return null
  return {
    lines: invoice.lines.map((l) => ({ rateBp: l.vatRateBp, baseCents: cents(l.totalExclTax), nature: l.nature })),
    breakdown: invoice.vatBreakdown.map((b) => ({ rateBp: b.vatRateBp, baseCents: cents(b.baseAmount), vatCents: cents(b.vatAmount) })),
  }
}

async function loadPeriodEntries(companyId: string, period: VatPeriod): Promise<VatEntry[]> {
  const rows = await prisma.accountingEntry.findMany({
    where: { companyId, status: 'validated', date: { gte: utc(period.start), lte: utc(period.end) } },
    orderBy: [{ date: 'asc' }, { entryNumber: 'asc' }],
    take: MAX_PERIOD_ENTRIES + 1,
    select: {
      id: true,
      entryNumber: true,
      date: true,
      reference: true,
      journal: { select: { code: true } },
      lines: { select: { debit: true, credit: true, account: { select: { code: true } } } },
      invoice: { select: INVOICE_SELECT },
      vatTransfers: { select: { invoice: { select: INVOICE_SELECT } } },
    },
  })
  if (rows.length > MAX_PERIOD_ENTRIES) {
    throw new ConflictError(`La période compte plus de ${MAX_PERIOD_ENTRIES} écritures : Kledg ne prépare pas la déclaration d’un tel volume.`)
  }
  return rows.map((row) => ({
    id: row.id,
    number: row.entryNumber,
    date: day(row.date),
    journalCode: row.journal.code,
    reference: row.reference,
    lines: row.lines.map((l) => ({ code: l.account.code, debitCents: cents(l.debit), creditCents: cents(l.credit) })),
    invoice: invoiceSource(row.invoice),
    vatTransferOf: row.vatTransfers.map((t) => invoiceSource(t.invoice)).filter((s): s is VatInvoiceSource => s !== null),
  }))
}

/**
 * Debit minus credit of the VAT accounts (445) before the period, by code:
 * the validated entries of the fiscal year containing the period's first
 * day dated before it, and that year's opening entries (journal AN).
 */
async function openingVatBalances(companyId: string, fiscalYearId: string | null, start: string): Promise<Map<string, number>> {
  if (!fiscalYearId) return new Map()
  const groups = await prisma.entryLine.groupBy({
    by: ['accountId'],
    where: {
      account: { companyId, fiscalYearId, code: { startsWith: '445' } },
      accountingEntry: { companyId, fiscalYearId, status: 'validated', OR: [{ date: { lt: utc(start) } }, { journal: { code: 'AN' } }] },
    },
    _sum: { debit: true, credit: true },
  })
  if (groups.length === 0) return new Map()
  const accounts = await prisma.account.findMany({ where: { companyId, id: { in: groups.map((g) => g.accountId) } }, select: { id: true, code: true } })
  const codeOf = new Map(accounts.map((a) => [a.id, a.code]))
  const out = new Map<string, number>()
  for (const g of groups) {
    const code = codeOf.get(g.accountId)
    if (!code) continue
    out.set(code, (out.get(code) ?? 0) + cents(g._sum.debit) - cents(g._sum.credit))
  }
  return out
}

const sumWhere = (map: Map<string, number>, test: (code: string) => boolean) => [...map.entries()].filter(([code]) => test(code)).reduce((s, [, v]) => s + v, 0)

/** Net debit minus credit by code of the period's entries that are operations (no opening, closing or settlement entry). */
function periodNets(entries: VatEntry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const entry of entries) {
    if (isBalanceEntry(entry) || isSettlementEntry(entry)) continue
    for (const l of entry.lines) out.set(l.code, (out.get(l.code) ?? 0) + l.debitCents - l.creditCents)
  }
  return out
}

/** The account a balance sits on: the code with the largest balance, else the root. */
function mainCode(map: Map<string, number>, test: (code: string) => boolean, fallback: string): string {
  const candidates = [...map.entries()].filter(([code]) => test(code)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  return candidates[0]?.[0] ?? fallback
}

/**
 * The period shown by default: the latest period over whose return is still
 * due (deadline today or later), else the period in progress, else the
 * latest one.
 */
function defaultPeriod(periods: VatPeriod[], deadlines: Map<string, string>, today: string): VatPeriod | undefined {
  const pending = periods.filter((p) => p.end < today && (deadlines.get(deadlineIdOfPeriod(p)) ?? '') >= today)
  if (pending.length > 0) return pending[pending.length - 1]
  return periods.find((p) => p.start <= today && p.end >= today) ?? periods[0]
}

function emptyView(today: string, status: VatReturnView['status'], periods: VatReturnPeriodOption[] = []): VatReturnView {
  return {
    today,
    status,
    periods,
    period: null,
    formTitle: null,
    deadline: null,
    computation: null,
    checks: [],
    reliable: false,
    movements: null,
    settlement: { reference: '', status: 'none', entryId: null, entryNumber: null },
    filing: null,
    notFromTheBooks: [],
    sources: status === 'exempt' ? [VAT_SOURCES.cgi293B, VAT_SOURCES.bofipFranchise] : [],
  }
}

function deadlinesAround(context: CompanyContext, from: string, to: string) {
  return computeDeadlines({ ...context, from, to })
}

async function filingsOf(companyId: string, keys: string[]): Promise<Map<string, VatFilingRecord>> {
  const rows = await prisma.vatReturnFiling.findMany({
    where: { companyId, periodKey: { in: keys } },
    select: { periodKey: true, filedOn: true, amountDue: true, creditAmount: true },
    take: keys.length,
  })
  return new Map(rows.map((r) => [r.periodKey, { filedOn: day(r.filedOn), amountDueCents: cents(r.amountDue), creditCents: cents(r.creditAmount) }]))
}

export interface BuiltVatReturn {
  view: VatReturnView
  basis: SettlementBasis | null
}

export async function buildVatReturn(companyId: string, periodKey: string | undefined, now?: Date): Promise<BuiltVatReturn> {
  const context = await loadDeadlineContext(companyId)
  const today = day(todayUtc(now))
  const thisMonth = `${today.slice(0, 7)}-01`
  const current = periodOfMonth(context.company, context.settings, thisMonth)

  // From the first fiscal year (at most five years back) to today.
  const firstStart = context.fiscalYears[0]?.startDate ?? null
  const earliest = `${Number(today.slice(0, 4)) - 5}-01-01`
  const from = firstStart && firstStart > earliest ? firstStart : earliest
  const periods = firstStart ? listPeriods(context.company, context.settings, from, today).slice(0, MAX_PERIODS) : []

  const requested = periodKey ? periodOfKey(periodKey) : null
  if (periodKey && !periods.some((p) => p.id === periodKey)) {
    if (current === 'none' && periods.length === 0) return { view: emptyView(today, 'exempt'), basis: null }
    throw new ValidationError(`Aucune déclaration de TVA pour la période ${requested?.label ?? periodKey} : choisissez une période de la liste.`)
  }
  if (periods.length === 0) {
    const status = current === 'none' ? 'exempt' : current === 'unknown' ? 'missing-regime' : 'no-period'
    return { view: emptyView(today, status), basis: null }
  }

  const deadlines = deadlinesAround(context, periods[periods.length - 1].end, addIsoDays(today, 400))
  const dueDates = new Map(deadlines.map((d) => [d.id, d.date]))
  const period = (periodKey ? periods.find((p) => p.id === periodKey) : defaultPeriod(periods, dueDates, today)) as VatPeriod
  const index = periods.indexOf(period)
  const previousKey = periods[index + 1]?.id ?? previousPeriodKey(period)

  const fiscalYear = context.fiscalYears.find((fy) => fy.startDate <= period.start && fy.endDate >= period.start) ?? null
  const endYear = context.fiscalYears.find((fy) => fy.startDate <= period.end && fy.endDate >= period.end) ?? null
  const reference = settlementReference(period)
  const range = { gte: utc(period.start), lte: utc(period.end) }
  // NOT on a nullable column would leave out the drafts without a reference.
  const notSettlement = { OR: [{ reference: null }, { reference: { not: reference } }] }

  const [entries, opening, drafts, draftCount, unreconciled, settlementEntry, filings] = await Promise.all([
    loadPeriodEntries(companyId, period),
    openingVatBalances(companyId, fiscalYear?.id ?? null, period.start),
    prisma.accountingEntry.findMany({
      where: { companyId, status: 'draft', date: range, ...notSettlement },
      orderBy: [{ date: 'asc' }, { entryNumber: 'asc' }],
      take: DRAFT_NUMBERS_SHOWN,
      select: { entryNumber: true },
    }),
    prisma.accountingEntry.count({ where: { companyId, status: 'draft', date: range, ...notSettlement } }),
    prisma.bankTransaction.aggregate({
      where: { ...transactionOfCompany(companyId), reconciled: false, date: range, OR: [{ status: null }, { status: { not: 'declined' } }] },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.accountingEntry.findFirst({ where: { companyId, reference }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, entryNumber: true } }),
    filingsOf(companyId, [...periods.map((p) => p.id), previousKey]),
  ])

  const movements = classifyEntries(entries)
  const carriedCode = mainCode(opening, isCreditCarriedCode, '44567')
  const creditCarriedCents = Math.max(sumWhere(opening, isCreditCarriedCode), 0)
  const computation = computeVatReturn({ form: period.form, movements, creditCarriedCents })

  // Balances at the end of the period, without this period's settlement (classify left settlements out).
  const nets = periodNets(entries)
  const end = (test: (code: string) => boolean) => sumWhere(opening, test) + sumWhere(nets, test)
  const declaredCollected = movements.groups.collected
  const balances: BalanceRow[] = [
    { group: 'collected', label: 'TVA collectée (4457)', balanceCents: -end(isCollectedCode), declaredCents: declaredCollected },
    { group: 'autoliquidation', label: 'TVA due intracommunautaire (4452)', balanceCents: -end(isAutoliquidationCode), declaredCents: movements.groups.autoliquidation },
    { group: 'deductibleFixedAssets', label: 'TVA sur immobilisations (44562)', balanceCents: end(isDeductibleFixedAssetsCode), declaredCents: movements.groups.deductibleFixedAssets },
    { group: 'deductibleOther', label: 'TVA sur autres biens et services (44566)', balanceCents: end(isDeductibleOtherCode), declaredCents: movements.groups.deductibleOther },
  ]

  // 4455: credit balance at the start, payments (debits) of the period outside this period's settlement.
  const toPayPaid = entries
    .filter((e) => e.reference !== reference && !isBalanceEntry(e))
    .flatMap((e) => e.lines)
    .filter((l) => isToPayCode(l.code))
    .reduce((s, l) => s + l.debitCents, 0)
  const previous = periods[index + 1] ?? null
  const previousDeadline = previous ? (dueDates.get(deadlineIdOfPeriod(previous)) ?? null) : null
  const previousFiling = filings.get(previousKey) ?? null

  const checks = vatChecks({
    drafts: { count: draftCount, numbers: drafts.map((d) => d.entryNumber) },
    unreconciled: { count: unreconciled._count._all, totalCents: Math.abs(cents(unreconciled._sum.amount)) },
    unidentified: movements.unidentified,
    unhandled: movements.unhandled,
    balances,
    toPay: {
      openingCents: -sumWhere(opening, isToPayCode),
      paidCents: toPayPaid,
      previousDueCents: previousFiling?.amountDueCents ?? null,
      previousDeadlinePassed: previousDeadline !== null && previousDeadline < today && previousDeadline <= period.end,
    },
    credit: { carriedCents: creditCarriedCents, previousCreditCents: previousFiling?.creditCents ?? null },
    pendingCollectedCents: movements.pendingCollectedCents,
  })

  const deadline = deadlines.find((d) => d.id === deadlineIdOfPeriod(period)) ?? null
  const view: VatReturnView = {
    today,
    status: 'ready',
    periods: periods.map((p) => ({ id: p.id, label: p.label, form: p.form, start: p.start, end: p.end, filed: filings.has(p.id) })),
    period,
    formTitle: FORM_TITLES[period.form],
    deadline: deadline ? { date: deadline.date, legalDate: deadline.legalDate, estimated: deadline.estimated, label: deadline.label } : null,
    computation,
    checks,
    reliable: isReliable(checks),
    movements: { entries: movements.entries, pendingCollectedCents: movements.pendingCollectedCents, unidentified: movements.unidentified, unhandled: movements.unhandled },
    settlement: {
      reference,
      status: settlementEntry ? (settlementEntry.status === 'validated' ? 'validated' : 'draft') : 'none',
      entryId: settlementEntry?.id ?? null,
      entryNumber: settlementEntry?.entryNumber ?? null,
    },
    filing: filings.get(period.id) ?? null,
    notFromTheBooks: NOT_FROM_THE_BOOKS[period.form],
    sources:
      period.form === 'CA3'
        ? [VAT_SOURCES.ca3Form, VAT_SOURCES.ca3Notice, VAT_SOURCES.bofipDecla, VAT_SOURCES.bofipContent, VAT_SOURCES.cgi287, VAT_SOURCES.pcg944]
        : [VAT_SOURCES.ca12Form, VAT_SOURCES.ca12Notice, VAT_SOURCES.bofipSimplified, VAT_SOURCES.bofipDecla, VAT_SOURCES.cgi287, VAT_SOURCES.pcg944],
  }

  const basis: SettlementBasis = {
    period,
    fiscalYear: endYear ? { id: endYear.id, year: endYear.year, isClosed: endYear.isClosed } : null,
    periodNetByCode: nets,
    creditCarried: { cents: creditCarriedCents, code: carriedCode },
    acomptes: period.form === 'CA12' ? { cents: Math.max(movements.acomptesPaidCents, 0), code: mainCode(nets, isAcompteCode, '44581') } : null,
  }
  return { view, basis }
}

/** GET /api/companies/[id]/vat-returns: the worksheet of a period (the period due next by default). */
export async function loadVatReturn(companyId: string, query: VatReturnQuery, now?: Date): Promise<VatReturnView> {
  return (await buildVatReturn(companyId, query.period, now)).view
}
