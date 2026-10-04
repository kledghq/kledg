import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { AuxiliaryBalanceQuerySchema, getAuxiliaryBalance } from '@/lib/reports/third-parties/get-third-party-reports.service'

/**
 * GET /api/reports/auxiliary-balance?companyId=&fiscalYearId=&startDate=&endDate=
 * Balance per customer and supplier of a period: opening, debit, credit,
 * balance and unlettered amount.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: AuxiliaryBalanceQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getAuxiliaryBalance(companyId, query), { headers: NO_CACHE_HEADERS }),
)
