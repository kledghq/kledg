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
}

/**
 * Builds the full theoretical monthly plan. Returns an empty plan when the
 * asset is not depreciable or misconfigured.
 */
export function buildDepreciationPlan(
  asset: FixedAssetPlanInput
): DepreciationPlan {
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
    const coef = toNumber(asset.decliningCoefficient) || 1.75
    return {
      ...empty,
      byMonth: buildDecliningMonthlyMap(baseCents, duration, coef, start),
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

  return { byMonth, baseAmount, start, method, duration }
}

/**
 * Declining-balance plan (French tax rule), prorata in whole months for the
 * first year, switching to linear once the linear rate on the remaining net
 * book value exceeds the declining rate. Works in cents: each annual
 * allowance is rounded to the cent, spread over its months with the
 * remainder on the last one, and the last year takes what is left, so the
 * months of a year add up to its allowance and the plan ends exactly on the
 * base.
 */
function buildDecliningMonthlyMap(
  baseCents: number,
  duration: number,
  coefficient: number,
  depreciationStart: Date
): Map<string, number> {
  const coef = coefficient > 0 ? coefficient : 1.75
  const decliningRate = (1 / duration) * coef
  const firstMonth = depreciationStart.getUTCMonth()
  const startYear = depreciationStart.getUTCFullYear()
  const firstYearMonths = 12 - firstMonth
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

    const calYear = startYear + y
    const monthsCount =
      y === 0 && isFirstYearPartial
        ? firstYearMonths
        : y === maxYears - 1 && isFirstYearPartial
          ? 12 - firstYearMonths
          : 12
    const monthStart = y === 0 ? firstMonth : 0

    // Rounded on the cumulative amount: the months add up to the allowance
    let spreadCents = 0
    for (let i = 0; i < monthsCount; i++) {
      const cumulative = Math.round((yearCents * (i + 1)) / monthsCount)
      result.set(monthKey(calYear, monthStart + i), fromCents(cumulative - spreadCents))
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

/** Sum of the plan's monthly amounts for the months of [from, to] (UTC calendar months), in cents. */
export function sumPlanCentsForPeriod(
  plan: DepreciationPlan,
  from: Date,
  to: Date
): number {
  let totalCents = 0
  const firstYear = from.getUTCFullYear()
  const lastYear = to.getUTCFullYear()
  for (let y = firstYear; y <= lastYear; y++) {
    const monthStart = y === firstYear ? from.getUTCMonth() : 0
    const monthEnd = y === lastYear ? to.getUTCMonth() : 11
    for (let m = monthStart; m <= monthEnd; m++) {
      totalCents += toCents(plan.byMonth.get(monthKey(y, m)) ?? 0) ?? 0
    }
  }
  return totalCents
}

export { monthKey }
