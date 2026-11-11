/**
 * Theoretical depreciation plan of a fixed asset: the monthly breakdown from
 * the depreciation start date until the base is fully depreciated. Two
 * methods: linear (prorata temporis in days) and declining (French tax rule).
 *
 * Sources:
 * - PCG art. 214-13 (ANC 2014-03): depreciation starts on the date the asset
 *   starts being used (start of consumption of its economic benefits), so the
 *   first year carries a prorata of the annual allowance.
 * - CGI art. 39, 1-2° and BOFiP BOI-BIC-AMT-20-20-20-10: linear depreciation
 *   runs from the in-service date, prorata temporis; the annual allowance
 *   (base x rate) is reduced in proportion to the time of use in the year.
 *
 * Opening accumulated depreciation: an asset acquired before the first fiscal
 * year Kledg follows may carry the depreciation booked before it
 * (openingDepreciation, as of openingDepreciationDate). The months before
 * that day then add up to it, and the months after it are rescaled so the
 * plan still ends on the base at its original end: the remaining depreciable
 * amount is spread over the remaining useful life (PCG art. 214-14, a change
 * of estimate applied prospectively). Fully depreciated already: nothing
 * after. Past the plan's end with something left: the rest in the month of
 * the opening day. The day counts by calendar month.
 *
 * Dates are calendar days stored at midnight UTC: every computation uses UTC
 * components, so the plan does not depend on the server timezone.
 */

import { toUtcDateOnly, utcDaysInclusive } from '@/lib/utils/date'
import { fromCents, toCents } from '@/lib/utils/money'

type Num = number | string | { toString(): string } | null | undefined

/** A rate, duration or coefficient (Prisma Decimal, string or number); `fallback` when absent or not a number. */
function toNumber(v: Num, fallback = 0): number {
  if (v === null || v === undefined) return fallback
  const text = typeof v === 'number' ? '' : String(v).trim()
  const n = typeof v === 'number' ? v : text === '' ? Number.NaN : Number(text)
  return Number.isFinite(n) ? n : fallback
}

/** Cents of an amount, 0 when absent or not a decimal. */
function amountCents(v: Num): number {
  return v === null || v === undefined ? 0 : (toCents(v) ?? 0)
}

export interface FixedAssetPlanInput {
  acquisitionValue: Num
  amortizableAmount: Num
  depreciationMethod: string
  depreciationRate: Num
  depreciationDuration: Num
  decliningCoefficient: Num
  depreciationStartDate: Date
  /** Month (1 to 12) the company's fiscal years close: the years of the declining method; December when absent. */
  fiscalYearClosingMonth?: number | null
  /** Depreciation booked before openingDepreciationDate, outside Kledg; both set or both absent. */
  openingDepreciation?: Num
  openingDepreciationDate?: Date | null
}

function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365
}

/** Days of depreciation in the window [windowStart, windowEnd], both included. */
function daysInWindow(
  windowStart: Date,
  windowEnd: Date,
  depreciationStart: Date
): number {
  if (windowEnd < depreciationStart) return 0
  const effectiveStart =
    depreciationStart > windowStart ? depreciationStart : windowStart
  return utcDaysInclusive(effectiveStart, windowEnd)
}

/**
 * Coefficient of the declining method by normal duration of use, when the
 * asset does not give one (CGI art. 39 A, 1): 1,25 for 3 or 4 years, 1,75
 * for 5 or 6 years, 2,25 beyond 6 years.
 */
export function legalDecliningCoefficient(duration: number): number {
  if (duration > 6) return 2.25
  if (duration >= 5) return 1.75
  return 1.25
}

export interface DepreciationPlan {
  /** Depreciation of each month, keyed "YYYY-MM". */
  byMonth: Map<string, number>
  /** Depreciable base. */
  baseAmount: number
  /** Depreciation start date (midnight UTC). */
  start: Date
  /** Method. */
  method: 'linear' | 'declining' | 'none'
  /** Effective duration (years). */
  duration: number
  /** Last day in service of a linear plan that ends mid-month (its last month's amount covers the days up to it); absent otherwise. */
  end?: Date
}

/**
 * Builds the full theoretical monthly plan. Returns an empty plan when the
 * asset is not depreciable or misconfigured.
 */
export function buildDepreciationPlan(
  asset: FixedAssetPlanInput
): DepreciationPlan {
  const plan = buildTheoreticalPlan(asset)
  if (asset.openingDepreciation === null || asset.openingDepreciation === undefined || !asset.openingDepreciationDate) return plan
  return withOpeningDepreciation(plan, amountCents(asset.openingDepreciation), toUtcDateOnly(new Date(asset.openingDepreciationDate)))
}

/** Spreads `totalCents` over `weights` in proportion, rounded on the cumulative amount (the parts add up exactly). */
function spread(weights: number[], totalCents: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  let done = 0
  let cumulativeWeight = 0
  return weights.map((w) => {
    cumulativeWeight += w
    const cumulative = sum > 0 ? Math.round((totalCents * cumulativeWeight) / sum) : 0
    const part = cumulative - done
    done = cumulative
    return part
  })
}

/**
 * The plan with the depreciation booked before `asOf` set to `openingCents`
 * (at most the base) and the months from `asOf` on rescaled to the rest.
 * Pure; see the module comment.
 */
export function withOpeningDepreciation(plan: DepreciationPlan, openingCents: number, asOf: Date): DepreciationPlan {
  const baseCents = toCents(plan.baseAmount) ?? 0
  if (plan.method === 'none' || baseCents <= 0) return plan
  const opening = Math.min(Math.max(0, openingCents), baseCents)
  const pivot = monthKey(asOf.getUTCFullYear(), asOf.getUTCMonth())
  const keys = [...plan.byMonth.keys()].sort()
  const before = keys.filter((k) => k < pivot)
  const after = keys.filter((k) => k >= pivot)
  const centsOf = (k: string) => toCents(plan.byMonth.get(k) ?? 0) ?? 0
  const byMonth = new Map<string, number>()

  // Before: the months of the plan carry the opening amount; none, the month before the opening day
  if (opening > 0) {
    const weights = before.map(centsOf)
    if (weights.some((w) => w > 0)) spread(weights, opening).forEach((c, i) => c && byMonth.set(before[i], fromCents(c)))
    else {
      const previous = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1))
      byMonth.set(monthKey(previous.getUTCFullYear(), previous.getUTCMonth()), fromCents(opening))
    }
  }
  // After: the rest over the remaining months, in their proportions; past the plan's end, in the opening month
  const rest = baseCents - opening
  if (rest > 0) {
    const weights = after.map(centsOf)
    if (weights.some((w) => w > 0)) spread(weights, rest).forEach((c, i) => c && byMonth.set(after[i], fromCents(c)))
    else byMonth.set(pivot, fromCents(rest))
  }
  return { ...plan, byMonth }
}

/** The plan from the asset's own terms, without opening depreciation. */
function buildTheoreticalPlan(asset: FixedAssetPlanInput): DepreciationPlan {
  const method = (asset.depreciationMethod || 'linear') as
    | 'linear'
    | 'declining'
    | 'none'
  const baseCents = amountCents(asset.amortizableAmount) || amountCents(asset.acquisitionValue)
  const baseAmount = fromCents(baseCents)
  const start = toUtcDateOnly(new Date(asset.depreciationStartDate))

  const empty: DepreciationPlan = {
    byMonth: new Map(),
    baseAmount,
    start,
    method,
    duration: 0,
  }

  if (method === 'none' || baseAmount <= 0) return empty

  let annualRate = 0
  const durationInput = toNumber(asset.depreciationDuration)
  const rateInput = toNumber(asset.depreciationRate)
  if (durationInput > 0) annualRate = 1 / durationInput
  else if (rateInput > 0) annualRate = rateInput / 100
  if (annualRate <= 0) return empty

  const duration = durationInput > 0 ? durationInput : Math.round(1 / annualRate)

  if (method === 'declining') {
    const given = toNumber(asset.decliningCoefficient)
    const coef = given > 0 ? given : legalDecliningCoefficient(duration)
    return {
      ...empty,
      byMonth: buildDecliningMonthlyMap(baseCents, duration, coef, start, (asset.fiscalYearClosingMonth ?? 12) - 1),
      duration,
    }
  }

  // Linear, prorata temporis in days: each day in service earns
  // base x rate / (days of its calendar year), so a full year earns exactly
  // base x rate, leap years included. Amounts are rounded on the cumulative
  // total: the months of a year add up to the rounded annual allowance and
  // the plan ends exactly on the base.
  const byMonth = new Map<string, number>()
  let yearsElapsed = 0
  let postedCents = 0
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth()
  // Safety cap: duration + 2 years at most.
  const hardStopYear = start.getUTCFullYear() + duration + 2

  while (postedCents < baseCents && year <= hardStopYear) {
    const monthStart = new Date(Date.UTC(year, month, 1))
    const monthEnd = new Date(Date.UTC(year, month + 1, 0))
    const days = daysInWindow(monthStart, monthEnd, start)
    if (days > 0) {
      yearsElapsed += days / daysInYear(year)
      const cumulative = Math.min(baseCents, Math.round(baseCents * annualRate * yearsElapsed))
      if (cumulative > postedCents) {
        byMonth.set(monthKey(year, month), fromCents(cumulative - postedCents))
        postedCents = cumulative
      }
    }
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }

  // Linear prorata temporis ends the day before the anniversary of the start: its last month is cut there
  const end = new Date(Date.UTC(start.getUTCFullYear() + Math.round(1 / annualRate), start.getUTCMonth(), start.getUTCDate() - 1))
  return { byMonth, baseAmount, start, method, duration, ...(start.getUTCDate() > 1 && { end }) }
}

/**
 * Declining-balance plan (French tax rule), prorata in whole months for the
 * first year, switching to linear once the linear rate on the remaining net
 * book value exceeds the declining rate. Works in cents: each annual
 * allowance is rounded to the cent, spread over its months with the
 * remainder on the last one, and the last year takes what is left, so the
 * months of a year add up to its allowance and the plan ends exactly on the
 * base.
 *
 * The years are the company's fiscal years (BOI-BIC-AMT-20-20-30-20: the
 * allowance and the first-year prorata apply per exercice): the first runs
 * from the month of the start to the closing month, then twelve months at
 * a time. December by default (calendar years).
 */
function buildDecliningMonthlyMap(
  baseCents: number,
  duration: number,
  coefficient: number,
  depreciationStart: Date,
  closingMonth = 11
): Map<string, number> {
  const decliningRate = (1 / duration) * coefficient
  const firstMonth = depreciationStart.getUTCMonth()
  const startYear = depreciationStart.getUTCFullYear()
  const firstYearMonths = ((closingMonth - firstMonth + 12) % 12) + 1
  const isFirstYearPartial = firstYearMonths < 12
  const maxYears = duration + (isFirstYearPartial ? 1 : 0)

  const result = new Map<string, number>()
  let bookCents = baseCents
  let switched = false
  let switchLinearFullCents = 0

  for (let y = 0; y < maxYears; y++) {
    if (bookCents <= 0) break
    const yearsLeft = duration - y
    const yearFraction =
      y === 0 && isFirstYearPartial
        ? firstYearMonths / 12
        : y === maxYears - 1 && isFirstYearPartial
          ? (12 - firstYearMonths) / 12
          : 1

    let yearCents: number
    if (switched) {
      yearCents = Math.round(switchLinearFullCents * yearFraction)
    } else {
      const declineFull = bookCents * decliningRate
      const linearFull = yearsLeft > 0 ? bookCents / yearsLeft : 0
      if (linearFull > declineFull) {
        switched = true
        switchLinearFullCents = linearFull
        yearCents = Math.round(linearFull * yearFraction)
      } else {
        yearCents = Math.round(declineFull * yearFraction)
      }
    }
    if (yearCents > bookCents || y === maxYears - 1) yearCents = bookCents // ends exactly on the base

    const monthsCount =
      y === 0 && isFirstYearPartial
        ? firstYearMonths
        : y === maxYears - 1 && isFirstYearPartial
          ? 12 - firstYearMonths
          : 12
    // First month of this fiscal year, counted from January of year 0
    const blockStart = startYear * 12 + firstMonth + (y === 0 ? 0 : firstYearMonths + 12 * (y - 1))

    // Rounded on the cumulative amount: the months add up to the allowance
    let spreadCents = 0
    for (let i = 0; i < monthsCount; i++) {
      const cumulative = Math.round((yearCents * (i + 1)) / monthsCount)
      const g = blockStart + i
      result.set(monthKey(Math.floor(g / 12), g % 12), fromCents(cumulative - spreadCents))
      spreadCents = cumulative
    }
    bookCents -= yearCents
  }
  return result
}

/** Sum of the plan's monthly amounts for the months of [from, to] (UTC calendar months), in euros. */
export function sumPlanForPeriod(
  plan: DepreciationPlan,
  from: Date,
  to: Date
): number {
  return fromCents(sumPlanCentsForPeriod(plan, from, to))
}

/**
 * Depreciation of the plan before `day` (midnight UTC), in cents: the whole
 * months before its month, plus the share of its month already elapsed, by
 * day. Rounded once, so periods computed as differences add up exactly.
 */
function cumulativeCentsBefore(plan: DepreciationPlan, day: Date): number {
  const y = day.getUTCFullYear()
  const m = day.getUTCMonth()
  const pivot = monthKey(y, m)
  let total = 0
  for (const [key, euros] of plan.byMonth) if (key < pivot) total += toCents(euros) ?? 0
  const monthCents = toCents(plan.byMonth.get(pivot) ?? 0) ?? 0
  if (!monthCents) return total
  // The month's amount runs over its days in service: from the in-service day in the first month
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const firstDay = plan.start.getUTCFullYear() === y && plan.start.getUTCMonth() === m ? plan.start.getUTCDate() : 1
  const lastDay = plan.end && plan.end.getUTCFullYear() === y && plan.end.getUTCMonth() === m ? plan.end.getUTCDate() : daysInMonth
  const elapsed = Math.min(day.getUTCDate() - firstDay, lastDay - firstDay + 1)
  if (elapsed > 0) total += Math.round((monthCents * elapsed) / (lastDay - firstDay + 1))
  return total
}

/**
 * Depreciation of the plan for the days of [from, to] (calendar days, UTC),
 * in cents. A month cut by the period counts for its days only: with a
 * fiscal year closing mid-month (14 March), the month shared by two years is
 * split between them instead of counted in both. Periods made of whole
 * months give the sum of those months, as before.
 */
export function sumPlanCentsForPeriod(
  plan: DepreciationPlan,
  from: Date,
  to: Date
): number {
  const after = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1))
  return Math.max(0, cumulativeCentsBefore(plan, after) - cumulativeCentsBefore(plan, from))
}

/** The closing month (1 to 12) of fiscal years ending on `endDate`: the years of the declining method. */
export function closingMonthOf(endDate: Date | null | undefined): number | undefined {
  return endDate ? new Date(endDate).getUTCMonth() + 1 : undefined
}

export { monthKey }
