import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { AgedBalanceQuerySchema, getAgedBalance } from '@/lib/reports/third-parties/get-third-party-reports.service'

/**
 * GET /api/reports/aged-balance?companyId=&fiscalYearId=&asOf=
 * Unlettered customer (411) and supplier (401) lines by age of their due
 * date (lib/reports/third-parties/third-party-balances.ts).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: AgedBalanceQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getAgedBalance(companyId, query), { headers: NO_CACHE_HEADERS }),
)
