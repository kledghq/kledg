import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { getParticipations, ParticipationsQuerySchema } from '@/lib/group/get-participations.service'

/**
 * GET /api/group/participations?companyId=&fiscalYearId=: the filiales and
 * participations of a holding (2059-G-SD, 2033-G-SD, annexe). reports:read
 * in the holding and in each subsidiary read.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: ParticipationsQuerySchema },
  async ({ companyId, user, query }) => NextResponse.json(await getParticipations(companyId, query, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
