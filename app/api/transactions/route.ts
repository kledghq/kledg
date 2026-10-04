import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { listTransactions, ListTransactionsQuerySchema } from '@/lib/transactions/list-transactions.service'

/**
 * GET /api/transactions
 *
 * Bank transactions of a company with filtering options (lib/transactions/list-transactions.service.ts,
 * ListTransactionsQuerySchema).
 *
 * Query parameters:
 * - companyId (required), bankAccountId ('all' for every account)
 * - reconciled ('true' | 'false'), startDate, endDate (calendar days yyyy-mm-dd, end included),
 *   fiscalYearId (the dates then narrow the fiscal year)
 * - minAmount, maxAmount, hasAttachments ('with' | 'without'), side ('debit' | 'credit')
 * - searchText (counterparty, label, reference)
 * - cashflowCategory, cashflowSubcategory, category, operationType (provider categories)
 * - includeSuggestions=true: rule suggestions per transaction (matchingRules)
 * - includeCategories=true: the available filter categories as well (categories)
 * - categoriesOnly=true: the categories only, with an empty transactions array
 * - limit (1 to 10,000) and cursor: one page; the response then has nextCursor
 *   while more transactions follow. Without limit, every matching transaction.
 *
 * @returns {transactions, categories?, balanceBefore?, nextCursor?}
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] }, query: ListTransactionsQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await listTransactions({ companyId, ...query })),
)

// Rule matching runs in memory: 30 seconds are enough
export const maxDuration = 30
