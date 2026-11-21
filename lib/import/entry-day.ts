/**
 * The day of an imported entry (#130), read as a calendar day: ISO
 * ("2026-03-05"), compact ("20260305") or day first ("05/03/2026",
 * "5.3.26"), the way French files write it, and an Excel date cell or
 * serial number. Never `new Date(text)`, which reads "05/03/2026" as
 * 3 May and "31/03/2026" as no date at all, and shifts with the server
 * timezone. The entries are created validated, so a wrong day would be
 * definitive (PCG art. 1031-3): an unreadable day refuses the entry.
 */

import { parseCalendarDate } from '@/lib/banking/import/date'
import { isoDateToUtc } from '@/lib/utils/date'

/** Excel day 0 is 30 December 1899 (with the 1900 leap year bug folded in). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const DAY_MS = 24 * 60 * 60 * 1000

/** The day at midnight UTC, the way entry days are stored; null when the value is not a day. */
export function importEntryDay(value: unknown): Date | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 200_000) return null
    const serial = new Date(EXCEL_EPOCH_MS + Math.floor(value) * DAY_MS)
    return isoDateToUtc(serial.toISOString().slice(0, 10))
  }
  if (!(value instanceof Date) && typeof value !== 'string') return null
  const day = parseCalendarDate(value)
  return day ? isoDateToUtc(day) : null
}

/** The French refusal of an unreadable day. */
export function unreadableDayMessage(key: string, value: unknown): string {
  return `Écriture ${key} : date illisible (« ${String(value ?? '').slice(0, 40)} »). Écrivez-la jour en premier (05/03/2026) ou au format 2026-03-05.`
}
