import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { getGroupStructure } from '@/lib/group/get-group-structure.service'

/**
 * GET /api/group/structure?companyId=: the organigramme of a holding's group
 * (people and companies, holdings with their percentage, officers).
 * reports:read in the holding and in each subsidiary read; a subsidiary the
 * user cannot read is a node "Société non accessible", never named nor read.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] } }, async ({ companyId, user }) =>
  NextResponse.json(await getGroupStructure(companyId, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
