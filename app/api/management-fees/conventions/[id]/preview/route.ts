import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { companyOfManagementFeeConvention } from '@/lib/api/resources'
import { userGroupAccess } from '@/lib/management-fees/access'
import { computeConventionFees, PeriodQuerySchema } from '@/lib/management-fees/compute-management-fees.service'

/**
 * GET /api/management-fees/conventions/[id]/preview?periodStart=&periodEnd=:
 * the fee of each subsidiary for the period (HT, TVA, TTC), the cost pool and
 * the warnings. Reads only; reports:read in the holding and in each subsidiary.
 */
export const GET = companyRoute(
  { company: fromResource(companyOfManagementFeeConvention), permission: { reports: ['read'] }, query: PeriodQuerySchema },
  async ({ companyId, params, user, query }) =>
    NextResponse.json(await computeConventionFees(companyId, params.id as string, query, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
