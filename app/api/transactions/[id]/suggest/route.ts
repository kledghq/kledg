import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfTransaction } from '@/lib/api/resources'
import { getTransactionRuleSuggestions } from '@/lib/transactions/rule-suggestions.service'

/**
 * GET /api/transactions/[id]/suggest
 * The assignment rules matching the transaction, with their confidence.
 *
 * @returns {transaction, matchingRules}
 */
export const GET = companyRoute(
  { company: fromResource(companyOfTransaction), permission: { banking: ['read'] } },
  async ({ params, companyId }) => NextResponse.json(await getTransactionRuleSuggestions(companyId, params.id as string)),
)
