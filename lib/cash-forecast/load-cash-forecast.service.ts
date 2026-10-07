/**
 * The cash forecast of a company (docs/prevision-tresorerie.md): today's
 * bank balance and the dated flows the books, the deadline calendar, the
 * recurring payments and the budget already hold, projected over the
 * horizon (projection.ts). No financial rule is written here: every flow
 * comes from a service an expert screen already uses (aged balance lines,
 * deadline calendar and its statuses, VAT return, corporate tax worksheet,
 * CFE avis, subscriptions, budgets), so the forecast and those screens
 * agree to the cent.
 *
 * Every query is scoped by the company the route resolved. The view holds
 * the flows of every component, so the page can switch them without asking
 * again; the projection it carries counts the components asked for (the
 * saved ones by default).
 */

import { z } from 'zod'
import type { FiscalYear } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { addIsoDays, calendarDayOf } from '@/lib/utils/date'
import { todayParis } from '@/lib/accounting/entry-date'
import { parseCents } from '@/lib/utils/money'
import { ledgerCashByMonth } from '@/lib/dashboard/ledger-cash'
import { loadThirdPartyLines, loadTiersDirectory } from '@/lib/reports/third-parties/get-third-party-reports.service'
import { getPaymentTerms } from '@/lib/companies/payment-terms.service'
import { loadDeadlineContext, type CompanyContext } from '@/lib/deadlines/load-deadlines.service'
import { computeDeadlines } from '@/lib/deadlines/engine'
import { trackDeadlines } from '@/lib/declarations/load-declaration-statuses.service'
import { declarationKindOf, type TrackedDeadline } from '@/lib/declarations/status'
import { vatReturnForDeadline } from '@/lib/vat-returns/vat-return-for-deadline.service'
import { buildCorporateTax } from '@/lib/corporate-tax/load-corporate-tax.service'
import { cfeSchedule } from '@/lib/local-taxes/cfe'
import { listDetectedSubscriptions } from '@/lib/subscriptions/detect-subscriptions.service'
import { findBudgetOfFiscalYear } from '@/lib/budgets/manage-budgets.service'
import { CASH_FORECAST_COMPONENTS, COMPONENT_INFO, isComponent, normalizeComponents, type CashForecastComponent } from './components'
import { averageMonthlyChange, budgetFlows, openItemFlows, recurringFlows, trendFlows, type BudgetPlan } from './flows'
import {
  FORECAST_GRANULARITIES,
  endOfMonth,
  forecastWindow,
  nextMonthStart,
  projectCashForecast,
  type CashFlowItem,
  type ForecastGranularity,
  type Projection,
} from './projection'
import { getCashForecastSettings } from './cash-forecast-settings.service'
import { alertOf, type CashForecastAlert } from './alert'
import type { CashForecastSettings } from './settings'

/** Complete months of bank lines the recent pace averages. */
export const TREND_MONTHS = 3
/** Flows returned at most (a company with thousands of open invoices keeps the largest). */
export const MAX_FLOWS = 2_000
/** Fiscal years whose budget may cover the horizon (twelve months touch two or three). */
const MAX_BUDGET_YEARS = 3

/**
 * ?companyId=&horizon=3|6|12&granularity=month|week&components=receivables,payables
 * Each parameter defaults to the saved settings (granularity: month).
 */
export const CashForecastQuerySchema = z.object({
  horizon: z.enum(['3', '6', '12'], { error: 'L’horizon est de 3, 6 ou 12 mois' }).transform(Number).optional(),
  granularity: z.enum(FORECAST_GRANULARITIES, { error: 'Granularité inconnue : month ou week' }).optional(),
  components: z
    .string()
    .max(200)
    .transform((value, ctx) => {
      const names = value.split(',').map((name) => name.trim()).filter(Boolean)
      const unknown = names.filter((name) => !isComponent(name))
      if (unknown.length > 0) {
        ctx.addIssue({ code: 'custom', message: `Composante inconnue : ${unknown.join(', ')}. Valeurs possibles : ${CASH_FORECAST_COMPONENTS.join(', ')}` })
        return z.NEVER
      }
      return normalizeComponents(names)
    })
    .optional(),
})
export type CashForecastQuery = z.infer<typeof CashForecastQuerySchema>

export interface CashForecastOpening {
  /** The balance the projection starts from, in cents. */
  cents: number
  /** bank: balances the banks report (euro accounts); ledger: the 512 accounts in the books; none: neither. */
  source: 'bank' | 'ledger' | 'none'
  /** Euro bank accounts read, and accounts in another currency left out. */
  bankAccounts: number
  otherCurrencies: number
  /** Balance of the 512 accounts at the end of the current month in the books, null without a fiscal year. */
  ledgerCents: number | null
}

export interface UnknownTax {
  day: string
  label: string
  ruleId: string
}

export interface ComponentAvailability {
  available: boolean
  /** Why nothing comes from it (French), null when it has flows. */
  reason: string | null
}

export interface CashForecastView {
  today: string
  start: string
  end: string
  horizonMonths: number
  granularity: ForecastGranularity
  settings: CashForecastSettings
  opening: CashForecastOpening
  /** Every flow of every component within the window (late ones included), by day. */
  items: CashFlowItem[]
  /** Flows left out beyond MAX_FLOWS (the smallest). */
  truncated: number
  /** Tax deadlines to pay in the window whose amount is not known: listed, not counted. */
  unknownTaxes: UnknownTax[]
  /** The recent pace, null without bank lines over the months it reads. */
  trend: { monthlyCents: number; months: string[] } | null
  availability: Record<CashForecastComponent, ComponentAvailability>
  projection: Projection
}

const day = (value: Date) => calendarDayOf(value) as string

/** The fiscal year containing today, else the latest one that started (its open items are the latest known). */
async function currentFiscalYear(companyId: string, today: string): Promise<FiscalYear | null> {
  const date = new Date(`${today}T00:00:00.000Z`)
  return (
    (await prisma.fiscalYear.findFirst({ where: { companyId, startDate: { lte: date }, endDate: { gte: date } }, orderBy: { startDate: 'desc' } })) ??
    (await prisma.fiscalYear.findFirst({ where: { companyId, startDate: { lte: date } }, orderBy: { startDate: 'desc' } }))
  )
}

// ------------------------------------------------------------------ opening balance

async function loadOpening(companyId: string, fy: FiscalYear | null, today: string): Promise<CashForecastOpening> {
  const [accounts, ledgerCents] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { bankConnection: { companyId }, supersededById: null },
      select: { balance: true, currency: true },
      take: 500,
    }),
    fy ? ledgerCashToday(companyId, fy, today) : Promise.resolve(null),
  ])
  const euros = accounts.filter((a) => a.currency === 'EUR')
  const bankCents = euros.reduce((sum, a) => sum + (parseCents(a.balance) ?? 0), 0)
  const source = euros.length > 0 ? 'bank' : ledgerCents !== null ? 'ledger' : 'none'
  return {
    cents: source === 'bank' ? bankCents : (ledgerCents ?? 0),
    source,
    bankAccounts: euros.length,
    otherCurrencies: accounts.length - euros.length,
    ledgerCents,
  }
}

/** Balance of the 512 accounts at the end of the month of `today` (or of the fiscal year's last month once it is over). */
async function ledgerCashToday(companyId: string, fy: FiscalYear, today: string): Promise<number> {
  const first = day(fy.startDate)
  const last = today < day(fy.endDate) ? today : day(fy.endDate)
  const months: Array<{ year: number; month: number }> = []
  for (let cursor = `${first.slice(0, 7)}-01`; cursor <= last; cursor = nextMonthStart(cursor)) {
    months.push({ year: Number(cursor.slice(0, 4)), month: Number(cursor.slice(5, 7)) - 1 })
  }
  const { openingCents, points } = await ledgerCashByMonth({ companyId, fiscalYearId: fy.id, months })
  return points.at(-1)?.balanceCents ?? openingCents
}

// ------------------------------------------------------------------ customers and suppliers

async function loadOpenItems(companyId: string, fy: FiscalYear | null, today: string, start: string): Promise<CashFlowItem[]> {
  if (!fy) return []
  const asOf = today < day(fy.endDate) ? today : day(fy.endDate)
  const [terms, lines, directory] = await Promise.all([getPaymentTerms(companyId), loadThirdPartyLines(companyId, fy.id, asOf), loadTiersDirectory(companyId)])
  return openItemFlows(lines, asOf, start, terms, directory)
}

// ------------------------------------------------------------------ taxes

const isPayment = (d: TrackedDeadline) => declarationKindOf(d.ruleId) !== 'file'
const isVat = (ruleId: string) => ruleId === 'tva-ca3' || ruleId === 'tva-ca12' || ruleId === 'tva-acompte'
const isCorporateTax = (ruleId: string) => ruleId === 'is-acompte' || ruleId === 'is-solde'
const isCfe = (ruleId: string) => ruleId === 'cfe' || ruleId === 'cfe-acompte'

/** Amounts of the IS deadlines the worksheet due next knows: its balance and the acomptes of the following year. */
async function corporateTaxAmounts(companyId: string, now?: Date): Promise<Map<string, number>> {
  const amounts = new Map<string, number>()
  let view
  try {
    ;({ view } = await buildCorporateTax(companyId, {}, { now, access: null }))
  } catch (error) {
    // No fiscal year or regime to compute from: no IS amount.
    if (error instanceof ValidationError || error instanceof NotFoundError) return amounts
    throw error
  }
  if (view.status !== 'ready') return amounts
  if (view.balance?.deadline) amounts.set(view.balance.deadline.id, view.balance.balanceCents)
  for (const item of view.acomptes?.items ?? []) {
    if (item.amountCents !== null) amounts.set(item.deadlineId, item.amountCents)
  }
  return amounts
}

/** The CFE of a deadline from the avis entered on the local taxes page (lib/local-taxes), as the simple home reads it. */
function cfeAmount(context: CompanyContext, deadline: TrackedDeadline): number | null {
  const year = Number(deadline.id.slice(deadline.id.indexOf(':') + 1))
  const avisOf = (y: number) => {
    const row = context.localTaxes.find((a) => a.year === y && a.cfeTotalCents !== null)
    return row ? { totalCents: row.cfeTotalCents as number, acompteCents: row.cfeAcompteCents } : null
  }
  const schedule = cfeSchedule(avisOf(year), avisOf(year - 1), 'normal')
  return deadline.ruleId === 'cfe' ? schedule.balanceCents : schedule.acompteCents || null
}

/** How far back late tax deadlines are looked for (a year of the calendar). */
export const LATE_TAX_LOOKBACK_DAYS = 366
/** VAT returns computed at most for late deadlines without a recorded amount (each builds a return). */
const MAX_LATE_VAT_RETURNS = 3

/**
 * The tax payments of the window: the deadlines of the calendar that ask
 * for a payment and are not settled, with their amount when known (the
 * amount recorded or held by another module; else the VAT return of the
 * period when its checks pass, the IS worksheet, the CFE avis). A credit
 * (VAT, an IS excess) is not a payment and is left out.
 *
 * A deadline of the last year already past and not marked paid is late:
 * with a known amount it is counted on the first day of the forecast, like
 * a late invoice (overdue); without one it is left out (the Échéances page
 * shows it as late). An upcoming deadline without an amount is listed apart.
 */
async function loadTaxes(companyId: string, today: string, start: string, end: string, now?: Date): Promise<{ items: CashFlowItem[]; unknown: UnknownTax[] }> {
  const context = await loadDeadlineContext(companyId)
  const computed = computeDeadlines({ ...context, from: addIsoDays(today, -LATE_TAX_LOOKBACK_DAYS), to: end })
  const deadlines = (await trackDeadlines(companyId, context, computed, today)).filter((d) => isPayment(d) && !d.status.settled)
  const late = (d: TrackedDeadline) => d.date < start
  const withoutAmount = (d: TrackedDeadline) => isVat(d.ruleId) && d.status.amountCents === null
  // The VAT returns to compute: the late ones (most recent first) and the next one due.
  const vatTargets = [
    ...deadlines.filter((d) => late(d) && withoutAmount(d)).slice(-MAX_LATE_VAT_RETURNS),
    ...deadlines.filter((d) => !late(d) && withoutAmount(d)).slice(0, 1),
  ]
  const [vatAmounts, corporateTax] = await Promise.all([
    Promise.all(vatTargets.map(async (d) => [d.id, await vatReturnForDeadline(companyId, d, now)] as const)),
    deadlines.some((d) => isCorporateTax(d.ruleId) && d.status.amountCents === null) ? corporateTaxAmounts(companyId, now) : Promise.resolve(new Map<string, number>()),
  ])
  const vat = new Map(vatAmounts.flatMap(([id, amount]) => (amount ? [[id, amount.amountCents] as const] : [])))
  const items: CashFlowItem[] = []
  const unknown: UnknownTax[] = []
  for (const d of deadlines) {
    let cents: number | null = d.status.amountCents
    if (cents === null && isVat(d.ruleId)) cents = vat.get(d.id) ?? null
    if (cents === null && isCorporateTax(d.ruleId)) cents = corporateTax.get(d.id) ?? null
    if (cents === null && isCfe(d.ruleId)) cents = cfeAmount(context, d)
    if (cents === null) {
      if (!late(d)) unknown.push({ day: d.date, label: d.label, ruleId: d.ruleId })
    } else if (cents > 0) {
      items.push({ component: 'taxes', label: d.label, day: d.date, amountCents: -cents, ruleId: d.ruleId, ...(late(d) ? { overdue: true } : {}) })
    }
  }
  return { items, unknown }
}

// ------------------------------------------------------------------ recurring payments

async function loadRecurring(companyId: string, today: string, start: string, end: string): Promise<CashFlowItem[]> {
  const { items } = await listDetectedSubscriptions(companyId, { today })
  return recurringFlows(
    items.map((s) => ({
      name: s.name,
      cadence: s.cadence,
      typicalAmountCents: s.typicalAmountCents,
      nextExpectedDay: s.nextExpectedDay,
      status: s.status,
      chargeReason: s.chargeReason,
      ignored: s.decision?.status === 'ignored',
    })),
    start,
    end,
  )
}

// ------------------------------------------------------------------ budget

async function loadBudget(companyId: string, today: string, end: string): Promise<CashFlowItem[]> {
  const first = nextMonthStart(today)
  if (first > end) return []
  const years = await prisma.fiscalYear.findMany({
    where: { companyId, startDate: { lte: new Date(`${endOfMonth(end)}T00:00:00.000Z`) }, endDate: { gte: new Date(`${first}T00:00:00.000Z`) } },
    orderBy: { startDate: 'asc' },
    take: MAX_BUDGET_YEARS,
    select: { id: true },
  })
  const budgets = await Promise.all(years.map((fy) => findBudgetOfFiscalYear(companyId, fy.id)))
  const plans: BudgetPlan[] = budgets.flatMap((b) => (b ? [{ months: b.months, lines: b.lines.map((l) => ({ accountPrefix: l.accountPrefix, plannedMonths: l.plannedMonths })) }] : []))
  return budgetFlows(plans, first, end)
}

// ------------------------------------------------------------------ recent pace

/** Credits minus debits of the euro bank accounts per complete month, the TREND_MONTHS months before the current one. */
async function loadTrend(companyId: string, today: string): Promise<{ monthlyCents: number; months: string[] } | null> {
  const thisMonth = `${today.slice(0, 7)}-01`
  const months: string[] = []
  for (let i = TREND_MONTHS; i >= 1; i--) months.push(addMonthsKey(thisMonth, -i))
  const from = new Date(`${months[0]}-01T00:00:00.000Z`)
  const before = new Date(`${thisMonth}T00:00:00.000Z`)
  const rows = await prisma.$queryRaw<Array<{ month: string; net: bigint | null; lines: bigint }>>`
    SELECT to_char(t."date", 'YYYY-MM') AS month,
           SUM(CASE WHEN t."side" = 'credit' THEN t."amount" ELSE -t."amount" END * 100)::bigint AS net,
           COUNT(*)::bigint AS lines
    FROM "bank_transactions" t
    JOIN "bank_accounts" a ON a."id" = t."bankAccountId"
    JOIN "bank_connections" c ON c."id" = a."bankConnectionId"
    WHERE c."companyId" = ${companyId}
      AND a."supersededById" IS NULL
      AND a."currency" = 'EUR'
      AND t."date" >= ${from}
      AND t."date" < ${before}
    GROUP BY 1
  `
  // A month without any line is a month the bank lines do not cover (not imported yet), not a month without movement.
  const covered = rows.filter((r) => Number(r.lines) > 0)
  const average = averageMonthlyChange(covered.map((r) => Number(r.net ?? BigInt(0))))
  return average === null ? null : { monthlyCents: average, months: covered.map((r) => r.month).sort() }
}

function addMonthsKey(firstOfMonth: string, months: number): string {
  const index = Number(firstOfMonth.slice(0, 4)) * 12 + Number(firstOfMonth.slice(5, 7)) - 1 + months
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

// ------------------------------------------------------------------ view

/** Keeps the MAX_FLOWS largest flows (late ones first), in day order. */
function bound(items: CashFlowItem[]): { items: CashFlowItem[]; truncated: number } {
  if (items.length <= MAX_FLOWS) return { items, truncated: 0 }
  const kept = [...items].sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents)).slice(0, MAX_FLOWS)
  return { items: kept.sort((a, b) => a.day.localeCompare(b.day)), truncated: items.length - MAX_FLOWS }
}

export async function getCashForecast(companyId: string, query: CashForecastQuery = {}, now?: Date): Promise<CashForecastView> {
  const today = todayParis(now)
  const settings = (await getCashForecastSettings(companyId)).settings
  const horizonMonths = query.horizon ?? settings.horizonMonths
  const granularity = query.granularity ?? 'month'
  const components = query.components ?? settings.components
  const { start, end } = forecastWindow(today, horizonMonths)
  const fy = await currentFiscalYear(companyId, today)

  const [opening, openItems, taxes, recurring, budget, trend] = await Promise.all([
    loadOpening(companyId, fy, today),
    loadOpenItems(companyId, fy, today, start),
    loadTaxes(companyId, today, start, end, now),
    loadRecurring(companyId, today, start, end),
    loadBudget(companyId, today, end),
    loadTrend(companyId, today),
  ])
  const all = [...openItems, ...taxes.items, ...recurring, ...budget, ...(trend ? trendFlows(trend.monthlyCents, today, end) : [])]
    .filter((item) => item.day <= end)
    .sort((a, b) => a.day.localeCompare(b.day) || a.component.localeCompare(b.component) || a.label.localeCompare(b.label, 'fr'))
  const { items, truncated } = bound(all)

  const availability = Object.fromEntries(
    CASH_FORECAST_COMPONENTS.map((c) => {
      const available = items.some((item) => item.component === c)
      return [c, { available, reason: available ? null : COMPONENT_INFO[c].empty }]
    }),
  ) as Record<CashForecastComponent, ComponentAvailability>

  return {
    today,
    start,
    end,
    horizonMonths,
    granularity,
    settings,
    opening,
    items,
    truncated,
    unknownTaxes: taxes.unknown,
    trend,
    availability,
    projection: projectCashForecast({ today, horizonMonths, granularity, openingCents: opening.cents, items, components, thresholdCents: settings.thresholdCents }),
  }
}

export interface CashForecastStatus {
  /** The saved threshold, null when none: the alert is off and nothing was computed. */
  thresholdCents: number | null
  horizonMonths: number
  alert: CashForecastAlert | null
}

/**
 * The threshold status of the dashboard and of the simple home (GET
 * /api/cash-forecast/alert): the saved threshold and horizon, and the alert
 * of the projection. Without a threshold nothing is computed.
 */
export async function getCashForecastStatus(companyId: string, now?: Date): Promise<CashForecastStatus> {
  const { settings } = await getCashForecastSettings(companyId)
  if (settings.thresholdCents === null) return { thresholdCents: null, horizonMonths: settings.horizonMonths, alert: null }
  return { thresholdCents: settings.thresholdCents, horizonMonths: settings.horizonMonths, alert: alertOf(await getCashForecast(companyId, {}, now)) }
}
