import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { CapitalCompositionQuerySchema, getCapitalComposition } from '@/lib/reports/capital-composition/get-capital-composition.service'

/** GET /api/reports/capital-composition?companyId=&fiscalYearId=: shareholders, shares, percentages, nominal amounts and checks. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: CapitalCompositionQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getCapitalComposition(companyId, query), { headers: NO_CACHE_HEADERS }),
)
