/**
 * Dates: the one module for reading, building and formatting them
 * (docs/conventions.md#dates).
 *
 * An accounting date is a calendar day, not an instant: it travels as
 * "yyyy-mm-dd", is stored at midnight UTC and never depends on the server
 * timezone. calendarDayOf is the one way to read a date value; todayUtc,
 * utcDate, addUtcDays, startOfDay / endOfDay build UTC dates; isIsoDate,
 * isoDateToUtc, addIsoDays and formatIsoDateFr work on ISO days. Accounting
 * edges (entry dates, FEC dates, validation day in France) are in
 * lib/accounting/entry-date.ts.
 *
 * Pure, no imports: usable in client components.
 */

/**
 * Formats a date according to French format
 */
export function formatDate(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  const defaultOptions: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }
  return new Intl.DateTimeFormat('fr-FR', options || defaultOptions).format(dateObj)
}

/**
 * Formats a date with time
 */
export function formatDateTime(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  const defaultOptions: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
  return new Intl.DateTimeFormat('fr-FR', options || defaultOptions).format(dateObj)
}

/**
 * Formats a date in short format (DD/MM/YYYY)
 */
export function formatDateShort(date: Date | string): string {
  return formatDate(date, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/**
 * Keeps only the calendar day in UTC (midnight UTC). Ignores time.
 * Use when ingesting transaction dates so storage is date-only and timezone-safe.
 *
 * @param date - Date or ISO string from API
 * @returns Same day at 00:00:00.000 UTC
 */
export function toUtcDateOnly(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
  )
}

/**
 * Formats a bank transaction date (date-only, no timezone shift).
 *
 * @param date - Date from API/DB (Date or ISO string)
 * @returns Formatted date string (dd/mm/yyyy) in French locale
 */
export function formatTransactionDate(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  return dateObj.toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/**
 * Normalizes a date to midnight UTC, regardless of how it was created
 * This ensures consistent date storage and comparison across different server timezones
 * 
 * Use this when creating dates that will be stored in the database to ensure
 * they are always stored at midnight UTC, making comparisons consistent.
 * 
 * @param date - Date to normalize (can be a Date object or date string)
 * @returns Date normalized to midnight UTC
 * 
 * @example
 * // Normalize a date string
 * const normalized = normalizeDate('2024-12-31') // 2024-12-31T00:00:00.000Z
 * 
 * // Normalize a Date object
 * const normalized = normalizeDate(new Date('2024-12-31')) // 2024-12-31T00:00:00.000Z
 */
export function normalizeDate(date: Date | string): Date {
  // The calendar day the value stands for (calendarDayOf), at midnight UTC:
  // "2025-12-31" stays the 31st on a server in Los Angeles (UTC-8) as well
  // as in Kiritimati (UTC+14).
  const day = calendarDayOf(date)
  return day ? isoDateToUtc(day) : new Date(Number.NaN)
}

const DAY_MS = 86_400_000

/**
 * The calendar day (yyyy-mm-dd) a date value stands for, or null when it is
 * not a date. The one way Kledg reads an accounting date:
 *
 * - "2025-12-31" is that day.
 * - A Date (or timestamp string) at midnight UTC is its UTC day: how Kledg
 *   stores dates, and what `new Date("2025-12-31")` gives.
 * - A Date at local midnight on this server is its local day
 *   (`new Date(2025, 11, 31)` in any timezone).
 * - Anything else is rounded to the nearest midnight UTC: a local midnight
 *   stored by a server in another timezone (Paris: 2025-12-30T23:00Z) is
 *   within 12 hours of the day it meant.
 *
 * For the current instant ("today"), use todayUtc(): rounding an instant
 * would move the afternoon to the next day.
 */
export function calendarDayOf(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return isIsoDate(trimmed) ? trimmed : null
    if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null
    return calendarDayOf(new Date(trimmed))
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null
  const time = value.getTime()
  const utcDay = (d: Date) => isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  if (time % DAY_MS === 0) return utcDay(value)
  // A Date built at local midnight on this server means that local day (documented above).
  // eslint-disable-next-line kledg/no-local-time-date
  if (value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0 && value.getMilliseconds() === 0) {
    // eslint-disable-next-line kledg/no-local-time-date
    return isoOf(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }
  return utcDay(new Date(Math.round(time / DAY_MS) * DAY_MS))
}

/** Today's calendar day in UTC, at midnight UTC (for "is this date past?"). */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/**
 * Midnight UTC of the calendar day of `date` (dates are stored at midnight
 * UTC). Independent of the server timezone, so a period filter never moves an
 * entry dated 31/12 into the next year.
 */
export function startOfDay(date: Date): Date {
  return normalizeDate(date)
}

/**
 * Last millisecond (23:59:59.999 UTC) of the calendar day of `date`, for
 * `lte` filters that must include every entry of the last day of a period.
 * Independent of the server timezone.
 */
export function endOfDay(date: Date): Date {
  const result = normalizeDate(date)
  result.setUTCHours(23, 59, 59, 999)
  return result
}

/** Date at midnight UTC for a calendar day (month is 1-12). */
export function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

/** The calendar day `days` days after `date` (midnight UTC); negative goes back. */
export function addUtcDays(date: Date, days: number): Date {
  const day = normalizeDate(date)
  day.setUTCDate(day.getUTCDate() + days)
  return day
}

/** Number of calendar days from `from` to `to`, both included (0 when `to` is before `from`). */
export function utcDaysInclusive(from: Date, to: Date): number {
  const ms = normalizeDate(to).getTime() - normalizeDate(from).getTime()
  return ms < 0 ? 0 : Math.round(ms / 86_400_000) + 1
}

/** Number of days of a month (month is 1-12): 28 to 31. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/*
 * Date-only values ("ISO dates", yyyy-mm-dd) for forms and APIs.
 *
 * An accounting date is a calendar day, not an instant: it travels as an ISO
 * date string and is stored at midnight UTC. These helpers never go through
 * the local timezone, so a date typed in Paris (or New York) is the same day
 * on the server.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function isRealDay(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return day <= days
}

function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Whether `value` is an existing calendar day written yyyy-mm-dd. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = ISO_DATE.exec(value)
  return !!m && isRealDay(Number(m[1]), Number(m[2]), Number(m[3]))
}

/**
 * Parses a date typed the French way (day first) into an ISO date, or null.
 * Accepts dd/mm/yyyy, d/m/yyyy, dd-mm-yyyy, dd.mm.yyyy, ddmmyyyy, dd/mm/yy
 * (20yy) and yyyy-mm-dd. Month-first (US) dates are refused, never swapped:
 * "12/31/2026" is invalid.
 */
export function parseFrenchDate(input: string): string | null {
  const s = input.trim()
  if (isIsoDate(s)) return s
  const m = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/.exec(s) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(s)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  return isRealDay(year, month, day) ? isoOf(year, month, day) : null
}

/** "2026-12-31" -> "31/12/2026" (empty string for anything else). */
export function formatIsoDateFr(iso: string): string {
  const m = ISO_DATE.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** Calendar day of a stored date (midnight UTC) or an ISO timestamp, as yyyy-mm-dd. */
export function toIsoDateUtc(date: Date | string): string {
  if (typeof date === 'string' && isIsoDate(date)) return date
  const d = typeof date === 'string' ? new Date(date) : date
  return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/**
 * The ISO date `days` days after `iso` ("2025-12-31", 1 -> "2026-01-01");
 * negative goes back. `iso` must be written yyyy-mm-dd.
 */
export function addIsoDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** ISO date -> Date at midnight UTC (how dates are stored). Throws on an invalid date. */
export function isoDateToUtc(iso: string): Date {
  if (!isIsoDate(iso)) throw new RangeError(`Invalid ISO date: ${iso}`)
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** ISO date -> local midnight Date, for date pickers that work in local time. */
export function isoDateToLocal(iso: string): Date | undefined {
  if (!isIsoDate(iso)) return undefined
  const [y, m, d] = iso.split('-').map(Number)
  // Date pickers work in the browser's local time: local midnight is the day shown.
  // eslint-disable-next-line kledg/no-local-time-date
  return new Date(y, m - 1, d)
}

/** Local Date (from a date picker) -> ISO date of the day the user clicked. */
export function localDateToIso(date: Date): string {
  // eslint-disable-next-line kledg/no-local-time-date
  return isoOf(date.getFullYear(), date.getMonth() + 1, date.getDate())
}
