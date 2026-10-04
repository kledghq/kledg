import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfRule } from '@/lib/api/resources'
import { deleteRule, RuleInputSchema, updateRule } from '@/lib/transactions/manage-rules.service'

/**
 * PUT /api/transaction-rules/[id]: replaces a rule (settings, conditions and entry lines).
 */
export const PUT = companyRoute(
  { company: fromResource(companyOfRule), permission: { ledger: ['manage'] }, body: RuleInputSchema },
  async ({ params, companyId, body }) => NextResponse.json({ rule: await updateRule(companyId, params.id as string, body) }),
)

/**
 * DELETE /api/transaction-rules/[id]: deletes a rule (entries it created stay).
 */
export const DELETE = companyRoute(
  { company: fromResource(companyOfRule), permission: { ledger: ['manage'] } },
  async ({ params, companyId }) => {
    await deleteRule(companyId, params.id as string)
    return NextResponse.json({ success: true })
  },
)
