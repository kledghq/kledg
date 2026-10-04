import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { AccountQuerySchema, getLetteringSuggestions } from '@/lib/lettering/lettering.service'

/**
 * GET /api/lettering/suggestions?companyId=&accountId=
 * Automatic lettering proposals of an account (lib/lettering/match.ts):
 * same amount and same tiers, payments found by reconciliation first.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: AccountQuerySchema },
  async ({ companyId, query }) =>
    NextResponse.json(await getLetteringSuggestions(companyId, query.accountId), { headers: NO_CACHE_HEADERS }),
)
