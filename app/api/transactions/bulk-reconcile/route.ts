import { NextResponse } from 'next/server'
import { companyRoute } from '@/lib/api/route'
import { fromTransactionIds } from '@/lib/api/transaction-resolvers'
import { BulkTransactionsSchema, reconcileTransactions } from '@/lib/transactions/bulk-transactions.service'

/**
 * POST /api/transactions/bulk-reconcile
 * Marks several transactions reconciled without entry; failures are reported per transaction.
 */
export const POST = companyRoute(
  { company: fromTransactionIds, permission: { banking: ['reconcile'] }, body: BulkTransactionsSchema },
  async ({ companyId, body }) => {
    const { results, errors } = await reconcileTransactions(companyId, body.transactionIds)
    return NextResponse.json({ success: true, reconciled: results.length, failed: errors.length, results, errors })
  },
)
