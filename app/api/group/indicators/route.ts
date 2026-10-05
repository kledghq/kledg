import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { GroupViewQuerySchema } from '@/lib/group/get-group-view.service'
import { getGroupIndicators } from '@/lib/group/get-group-indicators.service'

/**
 * GET /api/group/indicators?companyId=&fiscalYearId=: financial indicators N and N-1 of every company and of the aggregate (Comparaison, Ratios).
 * reports:read in the holding and in each subsidiary read; a subsidiary the
 * user cannot read is counted, never read.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: GroupViewQuerySchema },
  async ({ companyId, user, query }) => NextResponse.json(await getGroupIndicators(companyId, query, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
