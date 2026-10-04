import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { SOURCE_PERMISSIONS } from '@/lib/dashboard/widgets'
import { loadWidgetSource, WidgetDataQuerySchema } from '@/lib/dashboard/load-widget-data.service'

/**
 * GET /api/dashboard/widgets?companyId=&source=&fiscalYearId= : the data of
 * one dashboard source (lib/dashboard/widgets.ts). Each source needs its own
 * permission on top of reading the dashboard (bank lists need banking:read).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: WidgetDataQuerySchema },
  async ({ companyId, query, authorize, can }) => {
    authorize(SOURCE_PERMISSIONS[query.source])
    return NextResponse.json(await loadWidgetSource(companyId, query, { can }), { headers: NO_CACHE_HEADERS })
  },
)
