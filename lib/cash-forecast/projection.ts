/**
 * Projection of the bank balance (docs/prevision-tresorerie.md): today's
 * balance, then every dated flow added day by day up to the horizon, read
 * by month or by week. Pure, on plain values, amounts in integer cents and
 * days as yyyy-mm-dd: the API computes the saved view with it and the page
 * recomputes it in the browser when the user switches a component or the
 * granularity, so both always agree.
 *
 * Rules:
 * - the projection starts tomorrow (today's balance already holds today's
 *   bank lines) and ends on the same day of the month `horizonMonths` later
 *   (the last day of a shorter month);
 * - a flow due before tomorrow and still open (a late invoice) counts on
 *   the first day; a flow after the last day is left out;
 * - a flow spread over days (a month of budget, the recent pace) is split
 *   evenly over the days of its span, the remainder on the last ones, so
 *   the parts sum to the amount; only the days within the window count;
 * - the balance is followed day by day, so a dip inside a month (a tax paid
 *   on the 15th, a customer paying on the 30th) shows in the period's
 *   lowest balance and in the threshold alert, even when the month ends
 *   above the threshold;
 * - the threshold is crossed on the first day the balance is strictly under
 *   it; when today's balance already is, the alert says so.
 */

import { CASH_FORECAST_COMPONENTS, type CashForecastComponent } from './components'
import { addIsoDays, isoDateToUtc, lastDayOfMonth, utcDaysInclusive } from '@/lib/utils/date'

export type ForecastGranularity = 'month' | 'week'
export const FORECAST_GRANULARITIES = ['month', 'week'] as const

export interface CashFlowItem {
  component: CashForecastComponent
  /** What it is (French): "Studio Nord", "Déclaration de TVA de septembre 2026". */
  label: string
  /** Day it falls due, or first day of its span (yyyy-mm-dd). */
  day: string
  /** Last day of the span when the amount is spread evenly over days (yyyy-mm-dd, included). */
  until?: string
  /** Signed cents: positive comes in, negative goes out. */
  amountCents: number
  /** Due before the forecast starts and still open: counted on its first day. */
  overdue?: boolean
  /** Rule of the deadline calendar for a tax (lib/deadlines/rules.ts), for its plain words in simple mode. */
  ruleId?: string
}

export interface ComponentTotals {
  inflowsCents: number
  outflowsCents: number
  /** Flows of the component within the window. */
  count: number
}

export interface ForecastPeriod {
  /** "2026-10" for a month, the Monday "2026-10-05" for a week. */
  period: string
  start: string
  end: string
  openingCents: number
  /** Positive amounts of the period (cents). */
  inflowsCents: number
  /** Negative amounts of the period, as a negative number. */
  outflowsCents: number
  /** Net by component, enabled components only. */
  byComponent: Partial<Record<CashForecastComponent, number>>
  closingCents: number
  /** Lowest end-of-day balance of the period and its day. */
  lowestCents: number
  lowestDay: string
  /** The lowest balance of the period is under the threshold. */
  belowThreshold: boolean
}

export interface ThresholdCrossing {
  /** First day under the threshold (today when the balance already is). */
  day: string
  balanceCents: number
  /** The period holding that day, null when it is today. */
  period: string | null
  /** Today's balance is already under the threshold. */
  already: boolean
}

export interface Projection {
  today: string
  start: string
  end: string
  granularity: ForecastGranularity
  horizonMonths: number
  components: CashForecastComponent[]
  openingCents: number
  closingCents: number
  periods: ForecastPeriod[]
  lowest: { day: string; cents: number }
  thresholdCents: number | null
  firstBelow: ThresholdCrossing | null
  totals: Record<CashForecastComponent, ComponentTotals>
}

export interface ProjectionInput {
  today: string
  horizonMonths: number
  granularity: ForecastGranularity
  openingCents: number
  items: readonly CashFlowItem[]
  components: readonly CashForecastComponent[]
  thresholdCents: number | null
}

// ------------------------------------------------------------------ days

// Day arithmetic goes through lib/utils/date.ts (docs/conventions.md#dates).
const pad = (n: number) => String(n).padStart(2, '0')

/** The day `days` days after `day` (negative goes back). */
export const addDays = addIsoDays

/** Days from `from` to `to`, both included (0 when `to` is before `from`). */
export function daysInclusive(from: string, to: string): number {
  return utcDaysInclusive(isoDateToUtc(from), isoDateToUtc(to))
}

/** The same day `months` calendar months later, or the last day of a shorter month (31 August + 1 = 30 September). */
export function addMonths(day: string, months: number): string {
  const index = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + months
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return `${y}-${pad(m)}-${pad(Math.min(Number(day.slice(8, 10)), lastDayOfMonth(y, m)))}`
}

export function endOfMonth(day: string): string {
  return `${day.slice(0, 7)}-${pad(lastDayOfMonth(Number(day.slice(0, 4)), Number(day.slice(5, 7))))}`
}

/** First day of the next month. */
export function nextMonthStart(day: string): string {
  return addDays(endOfMonth(day), 1)
}

/** Sunday ending the week (weeks run Monday to Sunday). */
function endOfWeek(day: string): string {
  const weekday = isoDateToUtc(day).getUTCDay() // 0 Sunday
  return addDays(day, (7 - weekday) % 7)
}

/** Monday starting the week. */
function startOfWeek(day: string): string {
  const weekday = isoDateToUtc(day).getUTCDay()
  return addDays(day, -((weekday + 6) % 7))
}

/** First and last day of the forecast: tomorrow, and the same day `horizonMonths` later. */
export function forecastWindow(today: string, horizonMonths: number): { start: string; end: string } {
  return { start: addDays(today, 1), end: addMonths(today, horizonMonths) }
}

export interface PeriodBounds {
  period: string
  start: string
  end: string
}

/** The periods of the window, the first and the last cut by it. */
export function forecastPeriods(start: string, end: string, granularity: ForecastGranularity): PeriodBounds[] {
  const periods: PeriodBounds[] = []
  let cursor = start
  while (cursor <= end) {
    const natural = granularity === 'month' ? endOfMonth(cursor) : endOfWeek(cursor)
    const last = natural < end ? natural : end
    periods.push({ period: granularity === 'month' ? cursor.slice(0, 7) : startOfWeek(cursor), start: cursor, end: last })
    cursor = addDays(last, 1)
  }
  return periods
}

// ------------------------------------------------------------------ flows

/**
 * The parts of a flow by day: one part for a dated flow, an even split for
 * a span (part i is floor((i+1)A/n) - floor(iA/n), computed in BigInt, so
 * the parts sum to the amount exactly).
 */
export function flowParts(item: CashFlowItem): Array<{ day: string; cents: number }> {
  if (!item.until || item.until <= item.day) return [{ day: item.day, cents: item.amountCents }]
  const n = daysInclusive(item.day, item.until)
  const total = BigInt(Math.abs(item.amountCents))
  const sign = item.amountCents < 0 ? -1 : 1
  const count = BigInt(n)
  const parts: Array<{ day: string; cents: number }> = []
  for (let i = 0; i < n; i++) {
    const part = (BigInt(i + 1) * total) / count - (BigInt(i) * total) / count
    parts.push({ day: addDays(item.day, i), cents: sign * Number(part) })
  }
  return parts
}

const emptyTotals = (): Record<CashForecastComponent, ComponentTotals> =>
  Object.fromEntries(CASH_FORECAST_COMPONENTS.map((c) => [c, { inflowsCents: 0, outflowsCents: 0, count: 0 }])) as Record<CashForecastComponent, ComponentTotals>

export function projectCashForecast(input: ProjectionInput): Projection {
  const { start, end } = forecastWindow(input.today, input.horizonMonths)
  const enabled = new Set(input.components)
  const bounds = forecastPeriods(start, end, input.granularity)
  const periodOf = new Map<string, number>()
  bounds.forEach((p, index) => {
    for (let day = p.start; day <= p.end; day = addDays(day, 1)) periodOf.set(day, index)
  })

  const daily = new Map<string, number>()
  const periodFlows = bounds.map(() => ({ inflowsCents: 0, outflowsCents: 0, byComponent: {} as Partial<Record<CashForecastComponent, number>> }))
  const totals = emptyTotals()

  for (const item of input.items) {
    if (!enabled.has(item.component) || item.amountCents === 0) continue
    let counted = false
    for (const part of flowParts(item)) {
      if (part.day > end) continue
      // A spread flow counts its days within the window; a dated flow due before it counts on its first day.
      if (part.day < start && item.until) continue
      const day = part.day < start ? start : part.day
      const index = periodOf.get(day) as number
      daily.set(day, (daily.get(day) ?? 0) + part.cents)
      const flows = periodFlows[index]
      if (part.cents > 0) flows.inflowsCents += part.cents
      else flows.outflowsCents += part.cents
      flows.byComponent[item.component] = (flows.byComponent[item.component] ?? 0) + part.cents
      const total = totals[item.component]
      if (part.cents > 0) total.inflowsCents += part.cents
      else total.outflowsCents += part.cents
      counted = true
    }
    if (counted) totals[item.component].count += 1
  }

  const threshold = input.thresholdCents
  let balance = input.openingCents
  let lowest = { day: input.today, cents: balance }
  let firstBelow: ThresholdCrossing | null =
    threshold !== null && balance < threshold ? { day: input.today, balanceCents: balance, period: null, already: true } : null

  const periods: ForecastPeriod[] = bounds.map((p, index) => {
    const openingCents = balance
    let periodLowest = { day: p.start, cents: Number.POSITIVE_INFINITY }
    for (let day = p.start; day <= p.end; day = addDays(day, 1)) {
      balance += daily.get(day) ?? 0
      if (balance < periodLowest.cents) periodLowest = { day, cents: balance }
      if (balance < lowest.cents) lowest = { day, cents: balance }
      if (threshold !== null && firstBelow === null && balance < threshold) {
        firstBelow = { day, balanceCents: balance, period: p.period, already: false }
      }
    }
    const flows = periodFlows[index]
    return {
      period: p.period,
      start: p.start,
      end: p.end,
      openingCents,
      inflowsCents: flows.inflowsCents,
      outflowsCents: flows.outflowsCents,
      byComponent: flows.byComponent,
      closingCents: balance,
      lowestCents: periodLowest.cents,
      lowestDay: periodLowest.day,
      belowThreshold: threshold !== null && periodLowest.cents < threshold,
    }
  })

  return {
    today: input.today,
    start,
    end,
    granularity: input.granularity,
    horizonMonths: input.horizonMonths,
    components: CASH_FORECAST_COMPONENTS.filter((c) => enabled.has(c)),
    openingCents: input.openingCents,
    closingCents: balance,
    periods,
    lowest,
    thresholdCents: threshold,
    firstBelow,
    totals,
  }
}
