/**
 * The open fiscal year a write needs (creating an account, importing a
 * journal, completing a chart). When the company has none, the year
 * containing today is created through the normal path, `createFiscalYear`
 * (closing day and month of the company, PCG chart seeded, refused when the
 * year exists). Reads never create a year: they use `getActiveFiscalYear`
 * and answer an empty state (KLEDG-R3-QUAL-06).
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { createFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'
import { todayParis } from '@/lib/accounting/entry-date'
import { addIsoDays, lastDayOfMonth, toIsoDateUtc } from '@/lib/utils/date'

/**
 * Bounds of the fiscal year containing `today` for a company closing on
 * `closingDay`/`closingMonth` (clamped to the length of the month): it
 * ends on the next closing day on or after today and starts the day after
 * the previous one. `year` is the year of its end.
 */
export function fiscalYearAround(today: string, closingDay: number, closingMonth: number): { year: number; startDate: string; endDate: string } {
  const closingIn = (year: number) => `${year}-${String(closingMonth).padStart(2, '0')}-${String(Math.min(closingDay, lastDayOfMonth(year, closingMonth))).padStart(2, '0')}`
  const current = Number(today.slice(0, 4))
  const year = today <= closingIn(current) ? current : current + 1
  return { year, startDate: addIsoDays(closingIn(year - 1), 1), endDate: closingIn(year) }
}

/** The active fiscal year of the company, created (with its chart) when there is none. */
export async function ensureActiveFiscalYear(companyId: string, now: Date = new Date()) {
  const active = await getActiveFiscalYear(companyId)
  if (active) return active

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { closingDay: true, closingMonth: true } })
  if (!company) throw new NotFoundError('Société introuvable')
  const closingDay = company.closingDay || 31
  const closingMonth = company.closingMonth || 12

  let target = fiscalYearAround(todayParis(now), closingDay, closingMonth)
  // The year of today exists and is closed: the next one
  const latest = await prisma.fiscalYear.findFirst({ where: { companyId }, orderBy: { year: 'desc' }, select: { year: true, endDate: true } })
  if (latest && latest.year >= target.year) {
    const start = addIsoDays(toIsoDateUtc(latest.endDate), 1)
    target = { ...fiscalYearAround(start, closingDay, closingMonth), startDate: start }
  }
  return createFiscalYear(companyId, target)
}
