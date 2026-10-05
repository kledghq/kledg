/**
 * The period of the CVAE of a calendar year (CGI art. 1586 quinquies, I):
 * the calendar year itself, or the fiscal years closed during it when they
 * do not match it. A fiscal year closing later in the year counts while it
 * runs, as an estimate. Pure.
 *
 * The rate and the thresholds use the turnover brought to twelve months
 * (art. 1586 quater, I): in months when the period runs from a 1st to a
 * month end, else in days over 365 (same rule as the IS worksheet,
 * lib/corporate-tax/rules.ts).
 */

import { durationOf, mulDivRound } from '@/lib/corporate-tax/rules'

export interface PeriodFiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
  isClosed: boolean
}

export interface CvaePeriod {
  fiscalYears: Array<PeriodFiscalYear & { inProgress: boolean }>
  /** Months covered (null when a fiscal year is not in whole months). */
  months: number | null
  days: number
  /** A fiscal year of the period is not finished: the figures are an estimate. */
  estimate: boolean
}

/** The fiscal years closing in `year` (in Kledg), in date order; null when there is none. */
export function cvaePeriodOf(year: number, fiscalYears: readonly PeriodFiscalYear[], today: string): CvaePeriod | null {
  const closing = fiscalYears.filter((fy) => Number(fy.endDate.slice(0, 4)) === year).sort((a, b) => a.endDate.localeCompare(b.endDate))
  if (closing.length === 0) return null
  const durations = closing.map((fy) => durationOf(fy.startDate, fy.endDate))
  const months = durations.every((d) => d.months !== null) ? durations.reduce((sum, d) => sum + (d.months as number), 0) : null
  const days = durations.reduce((sum, d) => sum + d.days, 0)
  const withProgress = closing.map((fy) => ({ ...fy, inProgress: fy.endDate >= today && !fy.isClosed }))
  return { fiscalYears: withProgress, months, days, estimate: withProgress.some((fy) => fy.inProgress) }
}

/** The turnover brought to twelve months: x 12 / months, or x 365 / days; unchanged for twelve months. */
export function annualize(turnoverCents: number, period: Pick<CvaePeriod, 'months' | 'days'>): number {
  if (period.months === 12) return turnoverCents
  if (period.months !== null) return mulDivRound(turnoverCents, 12, period.months)
  if (period.days === 365 || period.days === 366) return turnoverCents
  return mulDivRound(turnoverCents, 365, period.days)
}
