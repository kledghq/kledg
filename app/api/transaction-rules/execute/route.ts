import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromBody } from '@/lib/api/route'
import { MAX_TRANSACTIONS_PAGE } from '@/lib/transactions/list-transactions.service'
import { processTransactions } from '@/lib/services/transactions/transaction-processing-service'

const ExecuteRulesSchema = z.object({
  companyId: z.string(),
  /** Only these transactions (limited to the company); default: the unreconciled ones of the current fiscal year. */
  transactionIds: z.array(z.string()).max(MAX_TRANSACTIONS_PAGE).optional(),
  /** true books the entries of the matching rules; false only counts the matches. */
  autoApply: z.boolean().optional().default(false),
})

/**
 * POST /api/transaction-rules/execute
 *
 * Runs the assignment rules on bank transactions of the company.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['reconcile'] }, body: ExecuteRulesSchema },
  async ({ companyId, body }) => {
    const results = await processTransactions({ companyId, transactionIds: body.transactionIds, autoApply: body.autoApply })
    return NextResponse.json({ success: true, results })
  },
)
