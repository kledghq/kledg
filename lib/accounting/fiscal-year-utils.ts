/**
 * Fiscal year utilities
 * 
 * Helper functions for managing fiscal years and their relationships with accounts
 */

import { prisma } from '@/lib/prisma'
import { calendarDayOf } from '@/lib/utils/date'
import { ConflictError } from '@/lib/accounting/errors'
import { fiscalYearContaining } from './entry-guards'

/**
 * Gets the active (non-closed) fiscal year for a company
 * Returns the most recent non-closed fiscal year, or null if none exists
 */
export async function getActiveFiscalYear(companyId: string) {
  const fiscalYear = await prisma.fiscalYear.findFirst({
    where: {
      companyId,
      isClosed: false,
    },
    orderBy: {
      year: 'desc',
    },
  })

  return fiscalYear
}

/**
 * Gets the fiscal year that contains a given date.
 * Compares calendar days (lib/accounting/entry-date.ts), not instants: an
 * entry of 31/12 or 01/01 lands in the right fiscal year whatever the server
 * timezone and however the fiscal year bounds were stored.
 */
export async function getFiscalYearForDate(
  companyId: string,
  date: Date
): Promise<{ id: string; year: number } | null> {
  const day = calendarDayOf(date)
  if (!day) return null
  const fiscalYears = await prisma.fiscalYear.findMany({
    where: { companyId },
    select: { id: true, year: true, startDate: true, endDate: true },
    orderBy: { year: 'asc' },
  })
  const fiscalYear = fiscalYearContaining(fiscalYears, day)
  return fiscalYear ? { id: fiscalYear.id, year: fiscalYear.year } : null
}

/** No open fiscal year: reads answer an empty state, this message where one is needed. */
export const NO_OPEN_FISCAL_YEAR = 'Aucun exercice ouvert : créez l’exercice dans Paramètres, Exercices.'

/**
 * Gets the fiscal year that should be used for a given date: the one
 * containing it, else the active (open) fiscal year. Never creates one
 * (a read must not change state): 409 when the company has no open year.
 */
export async function getFiscalYearForEntry(
  companyId: string,
  date: Date
): Promise<{ id: string; year: number }> {
  // First, try to find a fiscal year that contains this date
  const fiscalYearForDate = await getFiscalYearForDate(companyId, date)

  if (fiscalYearForDate) {
    return fiscalYearForDate
  }

  // If no fiscal year contains this date, the active one
  const activeFiscalYear = await getActiveFiscalYear(companyId)
  if (!activeFiscalYear) throw new ConflictError(NO_OPEN_FISCAL_YEAR)

  return {
    id: activeFiscalYear.id,
    year: activeFiscalYear.year,
  }
}
