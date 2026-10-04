import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfRule } from '@/lib/api/resources'
import { simulateRule, SimulateRuleSchema } from '@/lib/transactions/rule-simulator'

/**
 * POST /api/transaction-rules/[id]/simulate: the entry a saved rule would
 * book for an example transaction (nothing is written).
 */
export const POST = companyRoute(
  { company: fromResource(companyOfRule), permission: { banking: ['read'] }, body: SimulateRuleSchema },
  async ({ params, companyId, body }) =>
    NextResponse.json(await simulateRule(params.id as string, body.transactionExample, companyId)),
)
