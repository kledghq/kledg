import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { getGroupView, GroupViewQuerySchema } from '@/lib/group/get-group-view.service'

/**
 * GET /api/group/view?companyId=&fiscalYearId=: the group view of a holding
 * (vue combinée, flux intragroupe, éliminations, trésorerie du groupe).
 * reports:read in the holding, then in each subsidiary read; a subsidiary
 * the user cannot read is counted, never read.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: GroupViewQuerySchema },
  async ({ companyId, user, query }) => NextResponse.json(await getGroupView(companyId, query, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
