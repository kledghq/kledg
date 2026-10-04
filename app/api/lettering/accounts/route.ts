import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { LetterableAccountsQuerySchema, listLetterableAccounts } from '@/lib/lettering/lettering.service'

/**
 * GET /api/lettering/accounts?companyId=&fiscalYearId=
 * Third-party accounts of the fiscal year with their unlettered lines.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: LetterableAccountsQuerySchema },
  async ({ companyId, query }) =>
    NextResponse.json(await listLetterableAccounts(companyId, query.fiscalYearId), { headers: NO_CACHE_HEADERS }),
)
