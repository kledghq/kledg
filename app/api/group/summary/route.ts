import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { getGroupSummary } from '@/lib/group/get-group-summary.service'

/**
 * GET /api/group/summary?companyId=: who the group of a holding is (name,
 * companies counted, main shareholder), for the switcher of the group space.
 * reports:read in the holding; subsidiaries are counted, never named.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] } }, async ({ companyId, user }) =>
  NextResponse.json(await getGroupSummary(companyId, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
