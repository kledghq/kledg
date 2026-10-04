import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { fromTransactionInBody, fromTransactionInQuery } from '@/lib/api/transaction-resolvers'
import {
  reconcileWithExistingEntry,
  reconcileWithExistingEntrySchema,
  unreconcileTransaction,
} from '@/lib/reconciliation/service'
import {
  getReconciliationOverview,
  ReconciliationQuerySchema,
  UnreconcileQuerySchema,
} from '@/lib/banking/get-reconciliation-overview.service'

/**
 * GET /api/banking/reconciliation?companyId=&bankAccountId=&startDate=&endDate=&includeTransactions=
 * The company's bank accounts, their transactions (unless
 * includeTransactions=false) and the entries booked on the bank ledger
 * accounts of the active fiscal year (lib/banking/get-reconciliation-overview.service.ts).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] }, query: ReconciliationQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getReconciliationOverview(companyId, query)),
)

export const POST = companyRoute(
  { company: fromTransactionInBody, permission: { banking: ['reconcile'] }, body: reconcileWithExistingEntrySchema },
  async ({ body, companyId }) => {
    // Conditional update: 409 when the transaction is already reconciled
    const transaction = await reconcileWithExistingEntry(companyId, body.transactionId, body.entryId || null)
    return NextResponse.json({
      id: transaction.id,
      reconciled: transaction.reconciled,
      reconciledAt: transaction.reconciledAt?.toISOString() || null,
      reconciledWith: transaction.reconciledWith,
    })
  },
)

/** Undoes a reconciliation (deletes the draft entry it created, see lib/reconciliation/service.ts). */
export const DELETE = companyRoute(
  { company: fromTransactionInQuery, permission: { banking: ['reconcile'] }, query: UnreconcileQuerySchema },
  async ({ query, companyId }) => {
    const result = await unreconcileTransaction(companyId, query.transactionId)
    return NextResponse.json({
      id: query.transactionId,
      reconciled: false,
      reconciledAt: null,
      reconciledWith: null,
      deletedEntryId: result.deletedEntryId,
    })
  },
)
