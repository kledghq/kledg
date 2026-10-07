/**
 * Automatic period closing, as the company set it in its deadline settings
 * (periodAutoLock, lib/deadlines/settings.ts; off by default). PCG art.
 * 1031-4: the closing of a period "est mise en œuvre au plus tard avant
 * l'expiration de la période suivante".
 *
 * - after_vat_filing: recording the filing of a VAT return closes the
 *   periods up to the end of its period (record-vat-filing.service.ts),
 *   or up to the day before a tax draft Kledg prepared in it (the
 *   settlement of that return, to validate once filed; booking-day.ts);
 * - monthly: the daily cron (app/api/cron/period-locks) closes each month
 *   periodAutoLockDelayDays days after its end.
 *
 * Every lock goes through lockPeriod (same checks: forward only, before the
 * last day of the year, no draft in the period). A year that cannot be
 * locked is skipped with its reason; nothing fails the caller.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isCronRequest } from '@/lib/banking/sync-banks.service'
import { handleError } from '@/lib/accounting/errors'
import { dayToDate, parisDayOf } from '@/lib/accounting/entry-date'
import { writeAuditLog } from '@/lib/audit'
import { parseDeadlineSettings } from '@/lib/deadlines/settings'
import { withSystemContext } from '@/lib/rls/context'
import { addIsoDays, calendarDayOf } from '@/lib/utils/date'
import { isKledgTaxDraftReference, KLEDG_TAX_DRAFT_PREFIXES } from './booking-day'
import { lockPeriod } from './lock-period.service'

/** Who locked a period automatically (fiscal_years.periodLockedById). */
export const AUTO_LOCK_USER = 'system:period-auto-lock'

export interface AutoLockResult {
  locked: Array<{ fiscalYearId: string; through: string }>
  skipped: Array<{ fiscalYearId: string; reason: string }>
}

/**
 * The last day a monthly closing reaches on `today`: the end of the latest
 * month whose end plus `delayDays` is on or before today.
 */
export function monthlyLockTarget(today: string, delayDays: number): string {
  const startOfMonth = `${today.slice(0, 7)}-01`
  let monthEnd = addIsoDays(startOfMonth, -1)
  while (addIsoDays(monthEnd, delayDays) > today) monthEnd = addIsoDays(`${monthEnd.slice(0, 7)}-01`, -1)
  return monthEnd
}

/**
 * The first day of a tax draft Kledg prepared (booking-day.ts) still waiting
 * in the year up to `through`, null when there is none.
 */
async function firstKledgTaxDraft(companyId: string, fiscalYearId: string, through: string): Promise<string | null> {
  const drafts = await prisma.accountingEntry.findMany({
    where: { companyId, fiscalYearId, status: 'draft', date: { lte: dayToDate(through) }, OR: KLEDG_TAX_DRAFT_PREFIXES.map((prefix) => ({ reference: { startsWith: prefix } })) },
    select: { date: true, reference: true },
    orderBy: { date: 'asc' },
    take: 50,
  })
  const first = drafts.find((d) => isKledgTaxDraftReference(d.reference))
  return first ? calendarDayOf(first.date) : null
}

/**
 * Closes the periods of every open fiscal year of the company up to `through` (bounded to each year).
 * `beforeKledgTaxDrafts` (the closing after a VAT filing): stops the day before a tax draft Kledg
 * prepared in the period (the settlement of the return just filed, dated on its last day), which the
 * user validates after the filing; the next closing covers it (PCG art. 1031-4: before the end of the
 * following period).
 */
export async function lockOpenYearsThrough(
  companyId: string,
  through: string,
  userId = AUTO_LOCK_USER,
  options: { beforeKledgTaxDrafts?: boolean } = {},
): Promise<AutoLockResult> {
  const result: AutoLockResult = { locked: [], skipped: [] }
  const years = await prisma.fiscalYear.findMany({
    where: { companyId, isClosed: false },
    select: { id: true, startDate: true, endDate: true, periodLockedThrough: true },
    orderBy: { startDate: 'asc' },
  })
  for (const year of years) {
    const start = calendarDayOf(year.startDate)!
    const lastLockable = addIsoDays(calendarDayOf(year.endDate)!, -1)
    let target = through < lastLockable ? through : lastLockable
    if (options.beforeKledgTaxDrafts) {
      const draft = await firstKledgTaxDraft(companyId, year.id, target)
      if (draft && draft <= target) target = addIsoDays(draft, -1)
    }
    const current = calendarDayOf(year.periodLockedThrough)
    if (target < start || (current && target <= current)) continue
    try {
      await lockPeriod(companyId, year.id, target, userId)
      result.locked.push({ fiscalYearId: year.id, through: target })
    } catch (error) {
      result.skipped.push({ fiscalYearId: year.id, reason: handleError(error).message })
    }
  }
  if (result.skipped.length > 0) {
    await writeAuditLog('warn', 'Automatic period closing skipped', {
      action: 'PERIOD_AUTO_LOCK_SKIPPED',
      companyId,
      metadata: { through, skipped: result.skipped },
      context: { userId: null },
    })
  }
  return result
}

/** The daily run: every company in monthly mode, each narrowed to itself (row level security). */
export async function runMonthlyPeriodLocks(now = new Date()): Promise<{ companies: number; locked: number; skipped: number }> {
  const companies = await withSystemContext('cron:period-lock', () =>
    prisma.company.findMany({ where: { archivedAt: null }, select: { id: true, deadlineSettings: true } }),
  )
  const today = parisDayOf(now)
  let locked = 0
  let skipped = 0
  let count = 0
  for (const company of companies) {
    const settings = parseDeadlineSettings(company.deadlineSettings)
    if (settings.periodAutoLock !== 'monthly') continue
    count += 1
    const target = monthlyLockTarget(today, settings.periodAutoLockDelayDays)
    const result = await withSystemContext('cron:period-lock', () => lockOpenYearsThrough(company.id, target), { companyIds: [company.id] })
    locked += result.locked.length
    skipped += result.skipped.length
  }
  return { companies: count, locked, skipped }
}


/**
 * GET handler of app/api/cron/period-locks. With CRON_SECRET, only a
 * request with the bearer token runs; without it the route still works (a
 * fresh deployment needs no secret to paste) since it can only do what the
 * schedule would do anyway. The answer holds counts only.
 */
export async function handlePeriodLockCron(request: Request): Promise<Response> {
  if (process.env.CRON_SECRET && !isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ success: true, ...(await runMonthlyPeriodLocks()) })
  } catch (error) {
    const { message, statusCode } = handleError(error)
    return NextResponse.json({ error: message }, { status: statusCode })
  }
}
