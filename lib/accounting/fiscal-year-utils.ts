/**
 * Fiscal year utilities
 * 
 * Helper functions for managing fiscal years and their relationships with accounts
 */

import { prisma } from '@/lib/prisma'
import { normalizeDate, utcDate, addUtcDays, todayUtc } from '@/lib/utils/date'
import { calendarDayOf } from '@/lib/utils/date'
import { fiscalYearContaining } from './entry-guards'

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

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

/**
 * Gets or creates the active fiscal year for a company
 * If no active fiscal year exists, creates one based on the current date
 * and the company's closing day/month settings
 */
export async function getOrCreateActiveFiscalYear(companyId: string) {
  // Try to get existing active fiscal year
  let fiscalYear = await getActiveFiscalYear(companyId)

  if (fiscalYear) {
    return fiscalYear
  }

  // No active fiscal year exists, create one
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      closingDay: true,
      closingMonth: true,
      foundationDate: true,
    },
  })

  if (!company) {
    throw new Error(`Company ${companyId} not found`)
  }

  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const closingMonth = company.closingMonth || 12
  const closingDay = company.closingDay || 31

  // Fiscal year dates are calendar days at midnight UTC (see lib/utils/date).
  // The fiscal year ends on the closing day of the closing month (clamped to
  // the length of that month) and starts the day after the previous closing.
  const closingDateIn = (year: number) =>
    utcDate(year, closingMonth, Math.min(closingDay, daysInMonth(year, closingMonth)))
  const today = todayUtc(now)
  let year: number
  let endDate: Date
  if (today <= closingDateIn(currentYear)) {
    year = currentYear
    endDate = closingDateIn(currentYear)
  } else {
    year = currentYear + 1
    endDate = closingDateIn(currentYear + 1)
  }
  const startDate = addUtcDays(closingDateIn(year - 1), 1)

  // Check if a fiscal year for this year already exists (might be closed)
  const existingFiscalYear = await prisma.fiscalYear.findUnique({
    where: {
      companyId_year: {
        companyId,
        year,
      },
    },
  })

  if (existingFiscalYear) {
    // If it exists but is closed, we need to create the next one
    if (existingFiscalYear.isClosed) {
      const nextYear = year + 1
      const nextStartDate = addUtcDays(existingFiscalYear.endDate, 1)
      const nextEndDate = closingDateIn(nextYear)

      fiscalYear = await prisma.fiscalYear.create({
        data: {
          companyId,
          year: nextYear,
          closingDay,
          closingMonth,
          startDate: normalizeDate(nextStartDate),
          endDate: normalizeDate(nextEndDate),
          isClosed: false,
        },
      })
    } else {
      fiscalYear = existingFiscalYear
    }
  } else {
    // Create new fiscal year with normalized dates
    fiscalYear = await prisma.fiscalYear.create({
      data: {
        companyId,
        year,
        closingDay,
        closingMonth,
        startDate: normalizeDate(startDate),
        endDate: normalizeDate(endDate),
        isClosed: false,
      },
    })
  }

  return fiscalYear
}

/**
 * Gets the fiscal year that should be used for a given date
 * If the date falls within an existing fiscal year, returns that one
 * Otherwise, returns the active fiscal year
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

  // If no fiscal year contains this date, get or create the active one
  const activeFiscalYear = await getOrCreateActiveFiscalYear(companyId)

  return {
    id: activeFiscalYear.id,
    year: activeFiscalYear.year,
  }
}
