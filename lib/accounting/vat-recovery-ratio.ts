/**
 * VAT recovery ratio calculation
 * 
 * For VAT-exempt companies (e.g., training organizations), they can recover
 * deductible VAT proportionally based on the ratio of VAT-inclusive revenue
 * to total revenue.
 */

import { prisma } from '@/lib/prisma'
import { lastDayOfMonth, utcDate } from '@/lib/utils/date'
import { toCents } from '@/lib/utils/money'

/** Cents of a stored Decimal(15, 2) amount (exact). */
const cents = (value: { toString(): string }): number => toCents(value) ?? 0

/**
 * The calendar month of `day` in UTC, as the period of the recovery ratio:
 * first and last day at midnight UTC (how entry dates are stored), whatever
 * the server timezone.
 */
export function vatRecoveryMonthOf(day: Date): { periodStart: Date; periodEnd: Date } {
  const year = day.getUTCFullYear()
  const month = day.getUTCMonth() + 1
  return { periodStart: utcDate(year, month, 1), periodEnd: utcDate(year, month, lastDayOfMonth(year, month)) }
}

/**
 * Calculates the VAT recovery ratio for a company in a given period
 * 
 * Ratio = Revenue with VAT / Total Revenue
 * 
 * @param companyId - Company ID
 * @param periodStart - Period start date
 * @param periodEnd - Period end date
 * @returns Recovery ratio (0-1), or null if company is not VAT exempt or no revenue
 */
export async function calculateVatRecoveryRatio(
  companyId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<number | null> {
  // Get company VAT exemption status
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { isVatExempt: true },
  })

  // If company is not VAT exempt, return null (full recovery)
  if (!company?.isVatExempt) {
    return null
  }

  // Get all accounting entries for the period
  const entries = await prisma.accountingEntry.findMany({
    where: {
      companyId,
      date: {
        gte: periodStart,
        lte: periodEnd,
      },
      status: 'validated',
    },
    include: {
      lines: {
        include: {
          account: true,
        },
      },
    },
  })

  // Sums in cents: exact, and the ratio of two cent sums is the ratio of the euro sums.
  let totalRevenue = 0 // Total revenue (HT) from accounts 7xx, in cents
  let revenueWithVat = 0 // Revenue with VAT (calculated from VAT collected), in cents

  // Calculate total revenue from accounts 7xx (sales and services)
  for (const entry of entries) {
    for (const line of entry.lines) {
      const accountCode = line.account.code
      // Accounts 7xx: Sales and services (credit side)
      if (accountCode.startsWith('7')) {
        totalRevenue += cents(line.credit)
      }
    }
  }

  // If no revenue, return 0 (no recovery possible)
  if (totalRevenue === 0) {
    return 0
  }

  // Calculate revenue with VAT by finding entries that have both:
  // - Revenue (account 7xx on credit)
  // - VAT collected (account 44571 on credit)
  // This gives us the exact revenue that was invoiced with VAT
  
  const entriesWithVat = await prisma.accountingEntry.findMany({
    where: {
      companyId,
      date: {
        gte: periodStart,
        lte: periodEnd,
      },
      status: 'validated',
      lines: {
        some: {
          account: {
            code: '44571', // VAT collected on sales
          },
        },
      },
    },
    include: {
      lines: {
        include: {
          account: true,
        },
      },
    },
  })

  // For each entry with VAT collected, find the corresponding revenue (7xx)
  for (const entry of entriesWithVat) {
    let entryVatCollected = 0
    let entryRevenue = 0

    for (const line of entry.lines) {
      const accountCode = line.account.code
      if (accountCode === '44571') {
        // VAT collected is on credit side
        entryVatCollected += cents(line.credit)
      } else if (accountCode.startsWith('7')) {
        // Revenue is on credit side
        entryRevenue += cents(line.credit)
      }
    }

    // If we have both VAT and revenue in the same entry, this revenue has VAT
    if (entryVatCollected > 0 && entryRevenue > 0) {
      revenueWithVat += entryRevenue
    }
  }

  // Fallback: if we couldn't find entries with both VAT and revenue,
  // estimate from total VAT collected using average rate of 20%
  if (revenueWithVat === 0) {
    let totalVatCollected = 0
    for (const entry of entriesWithVat) {
      for (const line of entry.lines) {
        if (line.account.code === '44571') {
          totalVatCollected += cents(line.credit)
        }
      }
    }
    
    if (totalVatCollected > 0) {
      // Estimate: Revenue with VAT (HT) ≈ VAT collected / 20 % (standard rate,
      // CGI art. 278), i.e. five times the VAT, exact in cents
      const estimatedRevenueWithVat = totalVatCollected * 5
      revenueWithVat = Math.min(estimatedRevenueWithVat, totalRevenue)
    }
  }

  // Calculate ratio: revenue with VAT / total revenue
  const ratio = revenueWithVat / totalRevenue

  // Ensure ratio is between 0 and 1
  return Math.max(0, Math.min(1, ratio))
}
