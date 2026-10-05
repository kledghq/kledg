import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { GroupViewQuerySchema } from '@/lib/group/get-group-view.service'
import { getSimpleGroupHome } from '@/lib/group/get-simple-group-home.service'

/**
 * GET /api/group/simple-home?companyId=&fiscalYearId=: the group space in
 * simple mode (Accueil du groupe, Mes sociétés, Argent entre mes sociétés),
 * the figures of the expert views in plain words. reports:read in the
 * holding and in each subsidiary read; a subsidiary the user cannot read is
 * counted, never read nor named.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] }, query: GroupViewQuerySchema }, async ({ companyId, user, query }) =>
  NextResponse.json(await getSimpleGroupHome(companyId, query, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
