import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfTransaction } from '@/lib/api/resources'
import { applyRuleToTransaction } from '@/lib/transactions/rule-executor'

const ApplyRuleSchema = z.object({
  ruleId: z.string({ error: 'ruleId est requis' }).min(1, 'ruleId est requis'),
})

/**
 * POST /api/transactions/[id]/apply-rule: applies an assignment rule of the
 * company to the transaction.
 *
 * Creates the rule's draft entry and reconciles the transaction atomically:
 * 409 when the transaction is already reconciled (a second click, another user).
 */
export const POST = companyRoute(
  { company: fromResource(companyOfTransaction), permission: { banking: ['reconcile'] }, body: ApplyRuleSchema },
  async ({ params, companyId, body }) => {
    const { entryId } = await applyRuleToTransaction(companyId, params.id as string, body.ruleId)
    return NextResponse.json({ success: true, entryId })
  },
)
