import { NextResponse } from 'next/server'
import { companyRoute } from '@/lib/api/route'
import { fromTransactionIds } from '@/lib/api/transaction-resolvers'
import { BulkTransactionsSchema, unreconcileTransactions } from '@/lib/transactions/bulk-transactions.service'

/**
 * POST /api/transactions/bulk-unreconcile
 * Undoes the reconciliation of several transactions; failures are reported per transaction.
 */
export const POST = companyRoute(
  { company: fromTransactionIds, permission: { banking: ['reconcile'] }, body: BulkTransactionsSchema },
  async ({ companyId, body }) => {
    const { results, errors } = await unreconcileTransactions(companyId, body.transactionIds)
    return NextResponse.json({ success: true, unreconciled: results.length, failed: errors.length, results, errors })
  },
)
