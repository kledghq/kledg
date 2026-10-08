/**
 * Reads a date of a report request as a calendar day (yyyy-mm-dd, or a
 * stored date as an ISO timestamp), never through the server timezone
 * (query schemas in lib/reports/report-query.ts).
 */

import { ValidationError } from '@/lib/accounting/errors'
import { isIsoDate, isoDateToUtc, normalizeDate } from '@/lib/utils/date'

export function parseCalendarDay(value: string | null, name: string): Date | undefined {
  if (!value) return undefined
  if (isIsoDate(value)) return isoDateToUtc(value)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${name} invalide : ${value}`)
  return normalizeDate(date)
}
