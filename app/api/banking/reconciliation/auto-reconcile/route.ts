import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { AutoReconcileBodySchema, autoReconcile } from '@/lib/services/banking/reconciliation-service'

/**
 * POST /api/banking/reconciliation/auto-reconcile
 * 
 * Automatically reconciles bank entries with bank transactions.
 * Matches entries from the BQ (Bank) journal with unreconciled bank transactions
 * based on amount (within 0.01), date (within ±1 day), and transaction direction.
 * 
 * @param request - The HTTP request object
 * @param request.body - Reconciliation parameters
 * @param request.body.companyId - Company ID or slug (required)
 * @param request.body.startDate - Start date for filtering entries (optional)
 * @param request.body.endDate - End date for filtering entries (optional)
 * 
 * @returns JSON response with reconciliation results
 * @returns {success: boolean, matched: number, reconciledCount: number, total: number, unreconciledOrphanedCount: number, message: string}
 * 
 * @example
 * POST /api/banking/reconciliation/auto-reconcile
 * {
 *   "companyId": "123e4567-e89b-12d3-a456-426614174000",
 *   "startDate": "2024-01-01",
 *   "endDate": "2024-12-31"
 * }
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['reconcile'] }, body: AutoReconcileBodySchema },
  async ({ companyId, body }) => NextResponse.json(await autoReconcile({ companyId, ...body })),
)
