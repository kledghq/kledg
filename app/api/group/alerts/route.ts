import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { getGroupAlerts } from '@/lib/group/get-group-alerts.service'

/**
 * GET /api/group/alerts?companyId=: late declarations, transactions to
 * reconcile and draft entries of every company of the group the user reads.
 * reports:read in the holding and in each subsidiary read.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] } }, async ({ companyId, user }) =>
  NextResponse.json(await getGroupAlerts(companyId, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
