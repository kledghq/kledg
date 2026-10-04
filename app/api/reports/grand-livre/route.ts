import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getGrandLivre } from '@/lib/reports/ledger/grand-livre'
import { LedgerPeriodQuerySchema } from '@/lib/reports/report-query'

/**
 * GET /api/reports/grand-livre?companyId=&fiscalYearId= | &startDate=&endDate=
 * General ledger of a period within one fiscal year (lib/reports/ledger/grand-livre.ts).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: LedgerPeriodQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getGrandLivre({ companyId, ...query }), { headers: NO_CACHE_HEADERS }),
)
