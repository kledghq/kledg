import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getTrialBalanceFor } from '@/lib/reports/trial-balance/get-trial-balance.service'
import { LedgerPeriodQuerySchema } from '@/lib/reports/report-query'

/**
 * GET /api/reports/trial-balance?companyId=&fiscalYearId= | &startDate=&endDate=
 * Balance of a period within one fiscal year: opening balance (à-nouveaux
 * and entries before the period), movements, closing balance per account.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: LedgerPeriodQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getTrialBalanceFor({ companyId, ...query }), { headers: NO_CACHE_HEADERS }),
)
