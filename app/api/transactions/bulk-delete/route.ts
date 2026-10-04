import { NextResponse } from 'next/server'
import { companyRoute } from '@/lib/api/route'
import { fromTransactionIds } from '@/lib/api/transaction-resolvers'
import { BulkTransactionsSchema, deleteTransactions } from '@/lib/transactions/bulk-transactions.service'

/**
 * POST /api/transactions/bulk-delete
 * Deletes several bank transactions; failures are reported per transaction.
 */
export const POST = companyRoute(
  { company: fromTransactionIds, permission: { banking: ['manage'] }, body: BulkTransactionsSchema },
  async ({ companyId, body }) => {
    const { results, errors } = await deleteTransactions(companyId, body.transactionIds)
    return NextResponse.json({ success: true, deleted: results.length, failed: errors.length, results, errors })
  },
)
