/**
 * Accounting dates are calendar days, not instants.
 *
 * An entry dated 31/12/2025 belongs to the 2025 fiscal year whatever the
 * timezone of the server (Vercel runs in UTC, a self-hosted server may run in
 * Paris, Los Angeles or Kiritimati). Days travel as "yyyy-mm-dd" and are
 * stored at midnight UTC. These helpers never use the server timezone to
 * decide which day a value means, except for a Date built at local midnight
 * on this server (new Date(2025, 11, 31)), which means that local day.
 *
 * This module holds the accounting edges (entry dates with French errors,
 * FEC dates, the validation day in France). Reading, building and formatting
 * days is lib/utils/date.ts: calendarDayOf, isIsoDate, formatIsoDateFr.
 */

import { ValidationError } from './errors'
import { calendarDayOf, isIsoDate, isoDateToUtc } from '@/lib/utils/date'

/** A calendar day written yyyy-mm-dd. */
export type CalendarDay = string

/** Midnight UTC of a calendar day: how entry dates are stored. */
export function dayToDate(day: CalendarDay): Date {
  if (!isIsoDate(day)) throw new ValidationError(`Date invalide : ${day}`)
  return isoDateToUtc(day)
}

/** Entry date to store (midnight UTC), from what an API, a form or a service passes. */
export function toEntryDate(value: Date | string | null | undefined, field = 'Date'): Date {
  const day = calendarDayOf(value)
  if (!day) throw new ValidationError(`${field} invalide : utilisez le format AAAA-MM-JJ`)
  return dayToDate(day)
}

/** Calendar day of a stored date, throwing when the value is not a date. */
export function requireDay(value: Date | string): CalendarDay {
  const day = calendarDayOf(value)
  if (!day) throw new ValidationError('Date invalide')
  return day
}

/** FEC date (LPF art. A47 A-1): AAAAMMJJ, no separator. */
export function fecDateOf(value: Date | string): string {
  return requireDay(value).replace(/-/g, '')
}

const PARIS_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Calendar day in France of an instant (validation time, for the FEC ValidDate). */
export function parisDayOf(instant: Date): CalendarDay {
  return PARIS_DAY.format(instant)
}

/** Whether a calendar day lies within [start, end] (both included). Days compare as strings. */
export function isDayWithin(day: CalendarDay, start: CalendarDay, end: CalendarDay): boolean {
  return day >= start && day <= end
}
