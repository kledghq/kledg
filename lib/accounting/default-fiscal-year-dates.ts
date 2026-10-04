/**
 * Dates proposed for a new fiscal year, from the company's closing day and
 * month (pure: used by the fiscal years page in the browser).
 *
 * A fiscal year ends on the closing day of the closing month and starts the
 * day after the previous closing (Code de commerce art. L123-12: the annual
 * accounts are drawn up at the closing of each 12-month fiscal year). The
 * closing day is clamped to the length of the month, like the server does
 * (lib/accounting/fiscal-year-utils.ts): a company closing on 29 February
 * closes on 28 February in a common year, and a closing day of 31 in a
 * 30-day month is its last day, never the 1st of the next month.
 *
 * The first fiscal year starts at the company's foundation date when known.
 */

import { addIsoDays, calendarDayOf, lastDayOfMonth } from '@/lib/utils/date'

export interface DefaultFiscalYearInput {
  year: number
  closingDay?: number | null
  closingMonth?: number | null
  /** Foundation date of the company; used for its first fiscal year only. */
  foundationDate?: string | Date | null
  isFirstFiscalYear: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The closing day of `year` as yyyy-mm-dd (default 31 December). */
export function closingDayIn(year: number, closingDay?: number | null, closingMonth?: number | null): string {
  const month = closingMonth || 12
  const day = Math.min(closingDay || 31, lastDayOfMonth(year, month))
  return `${year}-${pad(month)}-${pad(day)}`
}

export function defaultFiscalYearDates(input: DefaultFiscalYearInput): { startDate: string; endDate: string } {
  const endDate = closingDayIn(input.year, input.closingDay, input.closingMonth)
  const foundation = input.isFirstFiscalYear ? calendarDayOf(input.foundationDate ?? null) : null
  const startDate = foundation ?? addIsoDays(closingDayIn(input.year - 1, input.closingDay, input.closingMonth), 1)
  return { startDate, endDate }
}
