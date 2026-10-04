import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { calculateDepreciationTable } from '@/lib/reports/depreciation.service'
import { assertFiscalYearsOwned, OptionalFiscalYearQuerySchema } from '@/lib/reports/report-query'

/** GET ?companyId=&fiscalYearId=: depreciation table of the fiscal year (the latest one by default). */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: OptionalFiscalYearQuerySchema },
  async ({ companyId, query }) => {
    await assertFiscalYearsOwned(companyId, query.fiscalYearId)
    return NextResponse.json(await calculateDepreciationTable(companyId, query.fiscalYearId), { headers: NO_CACHE_HEADERS })
  },
)
