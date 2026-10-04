import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { DeadlinesQuerySchema, loadDeadlinesView } from '@/lib/deadlines/load-deadlines.service'
import { DEADLINES_PERMISSION } from '@/lib/deadlines/permissions'

/**
 * GET /api/deadlines?companyId=&fiscalYearId= : the tax and legal deadlines
 * dated within a fiscal year (the active one by default), with the rule and
 * the official source of each (lib/deadlines/engine.ts). Dates only.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: DEADLINES_PERMISSION, query: DeadlinesQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await loadDeadlinesView(companyId, query), { headers: NO_CACHE_HEADERS }),
)
