/**
 * Account balance calculations
 * 
 * Handles calculation of account balances for financial reports
 */

import { prisma } from '@/lib/prisma'
import { startOfDay, endOfDay } from '@/lib/utils/date'
import type { AccountBalance, ReportPeriod } from './types'
import { sumAccountTotals } from './ledger/aggregate'
import { fromCents } from '@/lib/utils/money'

/**
 * Calculates the balance of a single account for a given period
 * Note: The account must belong to the correct fiscal year
 */
export async function getAccountBalance(
  companyId: string,
  accountId: string,
  period?: ReportPeriod
): Promise<number> {
  // Get the account to verify it exists and get its fiscal year
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { fiscalYearId: true },
  })

  if (!account) {
    return 0
  }

  // Get fiscalYearId from account
  const fiscalYearId = account.fiscalYearId
  if (!fiscalYearId) {
    return 0
  }

  const [row] = await sumAccountTotals({
    companyId,
    fiscalYearId,
    accountId,
    ...(period && { from: startOfDay(period.startDate), to: endOfDay(period.endDate) }),
  })
  return row ? fromCents(row.debitCents - row.creditCents) : 0
}

/**
 * Calculates balances for all accounts for a given period
 * @param excludeClosingEntries - If true, excludes the closing entries (journal CL or a CL- reference):
 *   the annual statements of a year are drawn up before its closing entry
 */
export async function getAllAccountBalances(
  companyId: string,
  period?: ReportPeriod,
  fiscalYearId?: string,
  excludeClosingEntries: boolean = false
): Promise<AccountBalance[]> {
  // Step 1: Determine the fiscal year
  let targetFiscalYearId: string | undefined = fiscalYearId
  
  if (!targetFiscalYearId && period) {
    // Find fiscal year that contains the period
    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: {
        companyId,
        startDate: { lte: period.endDate },
        endDate: { gte: period.startDate },
      },
    })
    if (fiscalYear) {
      targetFiscalYearId = fiscalYear.id
    }
  }

  if (!targetFiscalYearId) {
    // If no fiscal year found, return empty balances
    return []
  }

  // Step 2: Retrieve all accounts for the company and fiscal year
  const allAccounts = await prisma.account.findMany({
    where: {
      companyId,
      fiscalYearId: targetFiscalYearId,
    },
    select: { id: true, code: true, label: true },
    orderBy: { code: 'asc' },
  })

  if (allAccounts.length === 0) {
    return []
  }

  // Step 3: Initialize map with all accounts and create account IDs array
  const balancesMap = new Map<string, AccountBalance>()
  const accountIds: string[] = []
  for (const account of allAccounts) {
    accountIds.push(account.id)
    balancesMap.set(account.id, {
      accountId: account.id,
      code: account.code,
      label: account.label,
      debit: 0,
      credit: 0,
      balance: 0,
    })
  }

  // Step 4: totals of the validated entries per account, summed in cents by
  // PostgreSQL (lib/reports/ledger/aggregate.ts) instead of loading every line.
  const totals = await sumAccountTotals({
    companyId,
    fiscalYearId: targetFiscalYearId,
    ...(period && { from: startOfDay(period.startDate), to: endOfDay(period.endDate) }),
    excludeClosingEntries,
  })
  for (const row of totals) {
    const balance = balancesMap.get(row.accountId)
    if (!balance) continue
    balance.debit = fromCents(row.debitCents)
    balance.credit = fromCents(row.creditCents)
    balance.balance = fromCents(row.debitCents - row.creditCents)
  }

  return Array.from(balancesMap.values())
}
