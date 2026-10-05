import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { GroupViewQuerySchema } from '@/lib/group/get-group-view.service'
import { getGroupDeadlines } from '@/lib/group/get-group-deadlines.service'

/**
 * GET /api/group/deadlines?companyId=&fiscalYearId=: deadlines and tracker statuses of every company of the group.
 * reports:read in the holding and in each subsidiary read; a subsidiary the
 * user cannot read is counted, never read.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: GroupViewQuerySchema },
  async ({ companyId, user, query }) => NextResponse.json(await getGroupDeadlines(companyId, query, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
