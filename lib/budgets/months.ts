/**
 * Calendar months of a budget, as `yyyy-mm` keys. A budget is entered and
 * compared month by month over the calendar months its fiscal year touches:
 * a fiscal year from 2026-03-15 to 2027-03-14 has thirteen months, the first
 * and the last partial. Months are plain strings, never instants, so they
 * never depend on a timezone (docs/conventions.md#dates).
 *
 * Pure, no imports: usable on the server and in the browser.
 */

/** A calendar month, `yyyy-mm`. */
export type MonthKey = string

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === 'string' && MONTH_KEY.test(value)
}

/** Month of a calendar day (`yyyy-mm-dd`, or an ISO timestamp read as its UTC day). */
export function monthKeyOfDay(day: string): MonthKey {
  const key = day.slice(0, 7)
  if (!isMonthKey(key)) throw new RangeError(`Invalid calendar day: ${day}`)
  return key
}

/** Months since year 0: consecutive months differ by one, across years. */
export function monthIndex(key: MonthKey): number {
  const match = MONTH_KEY.exec(key)
  if (!match) throw new RangeError(`Invalid month: ${key}`)
  return Number(match[1]) * 12 + Number(match[2]) - 1
}

function monthOfIndex(index: number): MonthKey {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

/** Months from `first` to `last`, both included (empty when `last` is before `first`). */
export function monthsBetween(first: MonthKey, last: MonthKey): MonthKey[] {
  const months: MonthKey[] = []
  for (let i = monthIndex(first); i <= monthIndex(last); i++) months.push(monthOfIndex(i))
  return months
}

/** Calendar months touched by a fiscal year (days `yyyy-mm-dd`, both included). */
export function fiscalYearMonths(startDay: string, endDay: string): MonthKey[] {
  return monthsBetween(monthKeyOfDay(startDay), monthKeyOfDay(endDay))
}
