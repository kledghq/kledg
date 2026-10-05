import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { FiscalYearQuerySchema, getFixedAssetMovements } from '@/lib/annexe/get-fixed-asset-movements.service'

/**
 * GET /api/reports/fixed-asset-movements?companyId=&fiscalYearId=: forms 2054-SD, 2055-SD and 2033-C-SD
 * computed from the entries, with the checks against the balance sheet and the fixed asset register.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] }, query: FiscalYearQuerySchema }, async ({ companyId, query }) =>
  NextResponse.json(await getFixedAssetMovements(companyId, query.fiscalYearId), { headers: NO_CACHE_HEADERS }),
)
