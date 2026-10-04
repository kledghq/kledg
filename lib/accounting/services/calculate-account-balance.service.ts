/**
 * Calculates account balance for a given period
 * 
 * Calculates debit, credit, and net balance for an account.
 * Supports cumulative balance (for balance sheet) or period balance (for income statement).
 * 
 * @param accountId - Account ID
 * @param companyId - Company ID
 * @param period - Accounting period (optional)
 * @param cumulative - If true, calculates cumulative balance up to end date (for balance sheet)
 *                     If false, calculates balance only for the period (for income statement)
 * 
 * @returns Account balance details
 * @returns {debit: number} - Total debit amount
 * @returns {credit: number} - Total credit amount
 * @returns {balance: number} - Net balance (debit - credit)
 * 
 * @throws {Error} If database query fails
 * 
 * @example
 * // Balance sheet (cumulative)
 * const balance = await calculateAccountBalance('account-123', 'company-456', {
 *   startDate: new Date('2024-01-01'),
 *   endDate: new Date('2024-12-31')
 * }, true)
 * 
 * // Income statement (period only)
 * const balance = await calculateAccountBalance('account-123', 'company-456', {
 *   startDate: new Date('2024-01-01'),
 *   endDate: new Date('2024-12-31')
 * }, false)
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type { AccountingPeriod } from '../types'
import { parseCents, sumCents } from '@/lib/utils/money'

export async function calculateAccountBalance(
  accountId: string,
  companyId: string,
  period?: AccountingPeriod,
  cumulative: boolean = false
): Promise<{ debit: number; credit: number; balance: number }> {
  const where: Prisma.AccountingEntryWhereInput = {
    companyId,
    status: 'validated',
    lines: {
      some: {
        accountId,
      },
    },
    ...(period && {
      date: cumulative
        ? {
            lte: period.endDate,
          }
        : {
            gte: period.startDate,
            lte: period.endDate,
          },
    }),
  }

  const entries = await prisma.accountingEntry.findMany({
    where,
    include: {
      lines: {
        where: {
          accountId,
        },
      },
    },
  })

  // Exact sums in cents (no floating point accumulation)
  const lines = entries.flatMap((entry) => entry.lines)
  const debitCents = sumCents(lines.map((line) => parseCents(line.debit.toString()) ?? 0))
  const creditCents = sumCents(lines.map((line) => parseCents(line.credit.toString()) ?? 0))

  return {
    debit: Number(debitCents) / 100,
    credit: Number(creditCents) / 100,
    balance: Number(debitCents - creditCents) / 100,
  }
}
