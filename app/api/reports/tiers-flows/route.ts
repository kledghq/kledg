import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getTiersFlows, TiersFlowsQuerySchema } from '@/lib/reports/third-parties/get-third-party-reports.service'

/**
 * GET /api/reports/tiers-flows?companyId=&fiscalYearId=
 * What each customer was billed and each supplier billed over a fiscal
 * year, TTC, credit notes deducted (flow diagram of the Tiers page).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: TiersFlowsQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getTiersFlows(companyId, query), { headers: NO_CACHE_HEADERS }),
)
