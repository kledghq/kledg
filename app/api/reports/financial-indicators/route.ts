import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import {
  FinancialIndicatorsQuerySchema,
  getFinancialIndicators,
} from '@/lib/reports/financial-indicators/get-financial-indicators.service'

/**
 * GET /api/reports/financial-indicators?companyId=&fiscalYearId=
 * Soldes intermédiaires de gestion, CAF, BFR, trésorerie nette, délais et
 * ratios of a fiscal year (the current one by default) and of the previous
 * one (lib/reports/financial-indicators).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: FinancialIndicatorsQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getFinancialIndicators(companyId, query), { headers: NO_CACHE_HEADERS }),
)
