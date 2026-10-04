import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { simulateRuleFromData, SimulateRuleDataSchema } from '@/lib/transactions/rule-simulator'

/**
 * POST /api/transaction-rules/simulate: the entry a rule being edited would
 * book for an example transaction (nothing is written).
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['read'] }, body: SimulateRuleDataSchema },
  async ({ companyId, body }) =>
    NextResponse.json(await simulateRuleFromData(body.ruleData, body.transactionExample, companyId)),
)
