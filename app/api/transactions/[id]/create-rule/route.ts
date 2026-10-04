import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfTransaction } from '@/lib/api/resources'
import { getRuleDraftFromTransaction } from '@/lib/transactions/rule-suggestions.service'

/**
 * GET /api/transactions/[id]/create-rule
 * Draft of a new assignment rule prefilled from the transaction: suggested
 * name and conditions, entry lines of the best matching rule, matching rules.
 */
export const GET = companyRoute(
  { company: fromResource(companyOfTransaction), permission: { banking: ['read'] } },
  async ({ params, companyId }) => NextResponse.json(await getRuleDraftFromTransaction(companyId, params.id as string)),
)
