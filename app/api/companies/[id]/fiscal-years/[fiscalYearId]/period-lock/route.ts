import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { LockPeriodBodySchema, lockPeriod } from '@/lib/accounting/period-lock/lock-period.service'

/**
 * POST: closes the periods of the fiscal year up to `through` (PCG art.
 * 1031-4): no entry dated on or before that day can be created or validated
 * any more. Irreversible; refused while drafts are dated in the period.
 */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { closing: ['execute'] }, body: LockPeriodBodySchema },
  async ({ params, companyId, body, user }) =>
    NextResponse.json(await lockPeriod(companyId, params.fiscalYearId as string, body.through, user.id)),
)
