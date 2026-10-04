import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getYearEndInventory } from '@/lib/year-end/get-year-end-inventory.service'
import { FiscalYearQuerySchema } from '@/lib/year-end/schemas'

/** GET /api/year-end?companyId=&fiscalYearId=: the year-end inventory (provisions, impairments, grants) with the movements to book. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: FiscalYearQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getYearEndInventory(companyId, query.fiscalYearId), { headers: NO_CACHE_HEADERS }),
)
