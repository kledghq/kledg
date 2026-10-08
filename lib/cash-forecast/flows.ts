/**
 * The dated flows of a cash forecast, built from what the other modules
 * already hold (docs/prevision-tresorerie.md). Pure, on plain values: the
 * service loads, these functions turn the data into CashFlowItem.
 *
 * - Customers and suppliers: the open lines of the 411 and 401 accounts
 *   (the aged balance's lines, lib/reports/third-parties). Per tiers, the
 *   payments, credit notes and advances not lettered yet are set against
 *   its oldest invoices first; what remains of each invoice comes in (or
 *   goes out) on its due date (Code de commerce art. L441-10 terms, as the
 *   aged balance computes them). A tiers that owes nothing on balance
 *   (an advance, an overpayment) gives no flow: nothing is refunded by the
 *   forecast.
 * - Recurring payments: the series of lib/subscriptions, from their next
 *   expected day, at their current amount and cadence, the day anchored on
 *   that next payment (a payment of the 31st falls on the 30th in April and
 *   comes back to the 31st). Series ignored by the user, possibly stopped,
 *   and taxes (counted with the deadlines) are left out.
 * - Budget: the planned amounts of the months after the current one, spread
 *   over the days of each month; produits come in, charges go out; the
 *   non cash lines (dotations and reprises 68 and 78, stock variations 603
 *   and 713, book values of assets sold 675 and 775) are left out.
 * - Recent pace: an average monthly change, repeated each month from the
 *   next one, spread over its days.
 */

import type { PaymentTerms } from '@/lib/reports/third-parties/payment-terms'
import { kindOfAccount, lineDueDate, openOn, tiersOf, type ThirdPartyKind, type ThirdPartyLine, type TiersDirectory } from '@/lib/reports/third-parties/third-party-balances'
import { addDays, addMonths, endOfMonth, nextMonthStart, type CashFlowItem } from './projection'

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** "octobre 2026" for a day or a month key. */
export function monthLabel(dayOrMonth: string): string {
  return `${MONTH_NAMES[Number(dayOrMonth.slice(5, 7)) - 1]} ${dayOrMonth.slice(0, 4)}`
}

// ------------------------------------------------------------------ customers and suppliers

interface OpenInvoice {
  due: string
  cents: number
}

/**
 * Flows of the open 411 and 401 lines on `today`: customers come in,
 * suppliers go out, one flow per tiers and due day. `start` is the first
 * day of the forecast: an invoice due before it is marked overdue.
 */
export function openItemFlows(
  lines: readonly ThirdPartyLine[],
  today: string,
  start: string,
  terms: PaymentTerms,
  directory: TiersDirectory = new Map(),
): CashFlowItem[] {
  const byTiers = new Map<string, { kind: ThirdPartyKind; label: string; invoices: OpenInvoice[]; creditsCents: number }>()
  for (const line of lines) {
    const kind = kindOfAccount(line.accountCode)
    if (!kind || line.date > today || !openOn(line, today)) continue
    const owed = kind === 'customers' ? line.debitCents - line.creditCents : line.creditCents - line.debitCents
    if (owed === 0) continue
    const { code, label } = tiersOf(line, directory)
    const key = `${kind}:${code}`
    let tiers = byTiers.get(key)
    if (!tiers) {
      tiers = { kind, label, invoices: [], creditsCents: 0 }
      byTiers.set(key, tiers)
    }
    if (owed > 0) tiers.invoices.push({ due: lineDueDate(kind, line, directory.get(code)?.terms ?? terms), cents: owed })
    else tiers.creditsCents += -owed
  }

  const items: CashFlowItem[] = []
  for (const tiers of byTiers.values()) {
    // Oldest due date first: an unlettered payment settles the oldest invoice (the usual imputation).
    const invoices = [...tiers.invoices].sort((a, b) => a.due.localeCompare(b.due))
    let credits = tiers.creditsCents
    const byDay = new Map<string, number>()
    for (const invoice of invoices) {
      const used = Math.min(credits, invoice.cents)
      credits -= used
      const left = invoice.cents - used
      if (left > 0) byDay.set(invoice.due, (byDay.get(invoice.due) ?? 0) + left)
    }
    for (const [day, cents] of byDay) {
      items.push({
        component: tiers.kind === 'customers' ? 'receivables' : 'payables',
        label: tiers.label,
        day,
        amountCents: tiers.kind === 'customers' ? cents : -cents,
        ...(day < start ? { overdue: true } : {}),
      })
    }
  }
  return items.sort((a, b) => a.day.localeCompare(b.day) || a.label.localeCompare(b.label, 'fr'))
}

// ------------------------------------------------------------------ recurring payments

export interface RecurringSeries {
  name: string
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  /** Current amount of one payment, positive cents. */
  typicalAmountCents: number
  nextExpectedDay: string
  status: 'active' | 'price_changed' | 'possibly_stopped'
  /** Why a recurring charge is not a subscription; 'state' is a tax. */
  chargeReason: string | null
  /** The user set it aside (a transfer between own accounts, a false positive). */
  ignored: boolean
}

const CADENCE_MONTHS: Record<Exclude<RecurringSeries['cadence'], 'weekly'>, number> = { monthly: 1, quarterly: 3, yearly: 12 }

/** Payments of the series from their next expected day to `end`; one before `start` is overdue and counts on `start`. */
export function recurringFlows(series: readonly RecurringSeries[], start: string, end: string): CashFlowItem[] {
  const items: CashFlowItem[] = []
  for (const s of series) {
    if (s.ignored || s.status === 'possibly_stopped' || s.chargeReason === 'state' || s.typicalAmountCents <= 0) continue
    for (let n = 0; ; n++) {
      const day = s.cadence === 'weekly' ? addDays(s.nextExpectedDay, 7 * n) : addMonths(s.nextExpectedDay, CADENCE_MONTHS[s.cadence] * n)
      if (day > end) break
      items.push({ component: 'recurring', label: s.name, day, amountCents: -s.typicalAmountCents, ...(day < start ? { overdue: true } : {}) })
    }
  }
  return items.sort((a, b) => a.day.localeCompare(b.day) || a.label.localeCompare(b.label, 'fr'))
}

// ------------------------------------------------------------------ budget

/** Budget lines that move no cash: dotations and reprises (68, 78), stock variations (603, 713), book value and price of assets sold (675, 775: the sale itself is not a planned flow). */
const NON_CASH_BUDGET_PREFIXES = ['68', '78', '603', '713', '675', '775'] as const

export interface BudgetPlan {
  /** Calendar months of the budget (yyyy-mm). */
  months: readonly string[]
  lines: ReadonlyArray<{ accountPrefix: string; plannedMonths: readonly number[] }>
}

const nonCash = (prefix: string) => NON_CASH_BUDGET_PREFIXES.some((p) => prefix.startsWith(p))

/**
 * Two flows per month of the budgets from `firstDay`'s month to `end`'s:
 * the produits planned (in) and the charges planned (out), each spread
 * over the days of the month. A month in two budgets (fiscal years that
 * do not start on the 1st) adds both, as each budget plans its own days.
 */
export function budgetFlows(plans: readonly BudgetPlan[], firstDay: string, end: string): CashFlowItem[] {
  const byMonth = new Map<string, { in: number; out: number }>()
  for (const plan of plans) {
    plan.months.forEach((month, index) => {
      if (month < firstDay.slice(0, 7) || month > end.slice(0, 7)) return
      const totals = byMonth.get(month) ?? { in: 0, out: 0 }
      for (const line of plan.lines) {
        if (nonCash(line.accountPrefix)) continue
        const cents = line.plannedMonths[index] ?? 0
        if (line.accountPrefix.startsWith('7')) totals.in += cents
        else if (line.accountPrefix.startsWith('6')) totals.out += cents
      }
      byMonth.set(month, totals)
    })
  }
  const items: CashFlowItem[] = []
  for (const month of [...byMonth.keys()].sort()) {
    const totals = byMonth.get(month) as { in: number; out: number }
    const day = `${month}-01`
    const until = endOfMonth(day)
    if (totals.in !== 0) items.push({ component: 'budget', label: `Rentrées prévues au budget, ${monthLabel(month)}`, day, until, amountCents: totals.in })
    if (totals.out !== 0) items.push({ component: 'budget', label: `Dépenses prévues au budget, ${monthLabel(month)}`, day, until, amountCents: -totals.out })
  }
  return items
}

// ------------------------------------------------------------------ recent pace

/** The average change repeated each month from the month after `today` to `end`, spread over its days. */
export function trendFlows(monthlyCents: number, today: string, end: string): CashFlowItem[] {
  if (monthlyCents === 0) return []
  const items: CashFlowItem[] = []
  for (let day = nextMonthStart(today); day <= end; day = nextMonthStart(day)) {
    items.push({ component: 'trend', label: `Rythme récent, ${monthLabel(day)}`, day, until: endOfMonth(day), amountCents: monthlyCents })
  }
  return items
}

/**
 * Average monthly change of the bank over complete months, in cents
 * (rounded half away from zero): the net change of each month (credits
 * minus debits), averaged. Null without any month.
 */
export function averageMonthlyChange(monthlyNetCents: readonly number[]): number | null {
  if (monthlyNetCents.length === 0) return null
  const total = monthlyNetCents.reduce((sum, cents) => sum + cents, 0)
  const average = Math.abs(total) / monthlyNetCents.length
  // `|| 0`: never -0 for a small negative average rounded to zero
  return Math.sign(total) * Math.round(average) || 0
}
