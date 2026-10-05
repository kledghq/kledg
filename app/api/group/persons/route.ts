import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { getGroupPersons } from '@/lib/group/get-group-persons.service'

/**
 * GET /api/group/persons?companyId=: shareholders (with their direct and
 * indirect holdings) and officers of the companies of the group. Names and
 * photos only. reports:read in the holding and in each subsidiary read.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] } }, async ({ companyId, user }) =>
  NextResponse.json(await getGroupPersons(companyId, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
