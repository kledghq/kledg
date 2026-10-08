/**
 * Calendar date parsing for bank statements. Dates stay calendar dates
 * ("2026-03-05"): no Date object is built from local time, so nothing shifts
 * with the server timezone. A time part ("2026-03-05 23:10:00",
 * "2026-03-05T23:10:00+01:00") is dropped: the day written by the bank wins.
 */

import type { CalendarDate, DateFormat } from './types'

function isValidDay(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return d <= days[m - 1]
}

function toCalendar(y: number, m: number, d: number): CalendarDate | null {
  if (!isValidDay(y, m, d)) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Two-digit years: 00-69 are 20xx, 70-99 are 19xx. */
function fullYear(yy: string): number {
  const n = Number(yy)
  return yy.length === 2 ? (n < 70 ? 2000 + n : 1900 + n) : n
}

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/
const COMPACT = /^(\d{4})(\d{2})(\d{2})(?:\d{0,6}(?:\.\d+)?(?:\[.*\])?)?$/
const DMY = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:\s.*)?$/

/**
 * Parses a date. With `format`, only that layout is accepted (separators
 * "/", "." and "-" are interchangeable for day-first and month-first).
 * Without it, ISO and compact layouts are recognized and anything else is
 * read day first, as French banks write it.
 */
export function parseCalendarDate(input: string | Date | number | null | undefined, format?: DateFormat): CalendarDate | null {
  if (input === null || input === undefined) return null
  if (input instanceof Date) {
    // Excel cells (exceljs gives UTC midnight for date-only cells)
    if (Number.isNaN(input.getTime())) return null
    return toCalendar(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate())
  }
  if (typeof input === 'number') return null
  const s = input.trim()
  if (!s) return null

  const iso = ISO.exec(s)
  if (iso && (!format || format === 'yyyy-mm-dd')) return toCalendar(+iso[1], +iso[2], +iso[3])
  const compact = COMPACT.exec(s)
  if (compact && (!format || format === 'yyyymmdd')) return toCalendar(+compact[1], +compact[2], +compact[3])
  const dmy = DMY.exec(s)
  if (dmy) {
    const [a, b, y] = [Number(dmy[1]), Number(dmy[2]), dmy[3]]
    switch (format) {
      case undefined:
        return toCalendar(fullYear(y), b, a)
      case 'dd/mm/yyyy':
        return y.length === 4 ? toCalendar(+y, b, a) : null
      case 'dd/mm/yy':
        return y.length === 2 ? toCalendar(fullYear(y), b, a) : null
      case 'mm/dd/yyyy':
        return y.length === 4 ? toCalendar(+y, a, b) : null
      default:
        return null
    }
  }
  return null
}

/**
 * Picks the layout that reads every sample (or most of them). Day first
 * wins over month first unless a sample has a month above 12.
 */
export function detectDateFormat(samples: string[]): DateFormat {
  const values = samples.map((s) => s.trim()).filter(Boolean)
  if (values.length === 0) return 'dd/mm/yyyy'
  const score = (f: DateFormat) => values.filter((v) => parseCalendarDate(v, f) !== null).length
  const order: DateFormat[] = ['yyyy-mm-dd', 'dd/mm/yyyy', 'dd/mm/yy', 'yyyymmdd', 'mm/dd/yyyy']
  let best: DateFormat = 'dd/mm/yyyy'
  let bestScore = -1
  for (const f of order) {
    const n = score(f)
    if (n > bestScore) {
      best = f
      bestScore = n
    }
  }
  return best
}

/** Is this text a date in any supported layout? Used to find columns by content. */
export function looksLikeDate(value: string): boolean {
  return parseCalendarDate(value) !== null
}
