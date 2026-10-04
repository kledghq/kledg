/**
 * Budget against the books of its fiscal year (docs/budget.md).
 *
 * The actual amounts come from the ledger aggregate every report uses
 * (lib/reports/ledger/aggregate.ts): validated entries of the fiscal year, on
 * its accounts, closing entries excluded like the compte de résultat
 * (lib/reports/statements/load.ts), split by calendar month of the entry
 * date. The comparison itself is pure (report.ts).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { sumAccountTotalsByMonth } from '@/lib/reports/ledger/aggregate'
import { BUDGET_NOT_FOUND, findBudgetOfFiscalYear, getBudget, type BudgetDetail, type BudgetFiscalYear } from './manage-budgets.service'
import { isMonthKey, type MonthKey } from './months'
import { sideOfAccount } from './prefixes'
import { buildBudgetComparison, type AccountActuals, type BudgetComparison } from './report'

/** Query of GET /api/budgets/[id]/report. */
export const BudgetReportQuerySchema = z.object({
  throughMonth: z
    .string()
    .optional()
    .refine((value) => value === undefined || isMonthKey(value), 'Mois invalide : AAAA-MM'),
})

export interface BudgetReport extends BudgetComparison {
  budgetId: string
  fiscalYear: BudgetFiscalYear
}

async function compareWithBooks(companyId: string, budget: BudgetDetail, throughMonth?: MonthKey): Promise<BudgetReport> {
  if (throughMonth !== undefined && !budget.months.includes(throughMonth)) {
    throw new ValidationError(`Le mois ${throughMonth} n'est pas dans l'exercice ${budget.fiscalYear.year}.`)
  }
  const totals = await sumAccountTotalsByMonth({ companyId, fiscalYearId: budget.fiscalYear.id, excludeClosingEntries: true })
  const accountIds = [...new Set(totals.map((t) => t.accountId))]
  const accounts = await prisma.account.findMany({
    where: { companyId, fiscalYearId: budget.fiscalYear.id, id: { in: accountIds } },
    select: { id: true, code: true, label: true },
  })
  const monthIndex = new Map(budget.months.map((m, i) => [m, i]))
  const byAccount = new Map<string, AccountActuals & { debitBalances: number[] }>()
  for (const account of accounts) {
    if (sideOfAccount(account.code) === null) continue
    byAccount.set(account.id, { code: account.code, label: account.label, debitBalances: budget.months.map(() => 0) })
  }
  for (const row of totals) {
    const account = byAccount.get(row.accountId)
    const index = monthIndex.get(row.month)
    // Entries of a fiscal year are dated within it, so every month is one of its months.
    if (!account || index === undefined) continue
    account.debitBalances[index] += row.debitCents - row.creditCents
  }
  const comparison = buildBudgetComparison({
    months: budget.months,
    throughMonth,
    lines: budget.lines.map((l) => ({ id: l.id, accountPrefix: l.accountPrefix, label: l.label, months: l.plannedMonths })),
    accounts: [...byAccount.values()],
  })
  return { budgetId: budget.id, fiscalYear: budget.fiscalYear, ...comparison }
}

export async function getBudgetReport(companyId: string, budgetId: string, query: { throughMonth?: MonthKey } = {}): Promise<BudgetReport> {
  return compareWithBooks(companyId, await getBudget(companyId, budgetId), query.throughMonth)
}

/** The report of the budget of a fiscal year (MCP): 404 when the year has no budget. */
export async function getBudgetReportOfFiscalYear(companyId: string, fiscalYearId: string, query: { throughMonth?: MonthKey } = {}): Promise<BudgetReport> {
  const budget = await findBudgetOfFiscalYear(companyId, fiscalYearId)
  if (!budget) throw new NotFoundError(`${BUDGET_NOT_FOUND} : cet exercice n'a pas de budget.`)
  return compareWithBooks(companyId, budget, query.throughMonth)
}
