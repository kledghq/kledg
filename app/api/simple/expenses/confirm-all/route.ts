import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { ConfirmAllBodySchema, confirmHighConfidenceExpenses } from '@/lib/simple/confirm-expense.service'

/**
 * POST /api/simple/expenses/confirm-all { companyId, transactionIds }
 * "Tout confirmer": confirms the lines whose suggestion, recomputed here, is
 * of high confidence with no question to answer; the others are returned in
 * `skipped` with the reason. Each line in its own transaction.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['reconcile'] }, body: ConfirmAllBodySchema },
  async ({ companyId, body, user, authorize, can }) => {
    authorize({ entries: ['create'] })
    const result = await confirmHighConfidenceExpenses(companyId, body.transactionIds, {
      userId: user.id,
      canValidate: can({ entries: ['validate'] }),
      source: 'web',
    })
    return NextResponse.json(result)
  },
)
