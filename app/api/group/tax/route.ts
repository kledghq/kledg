import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { getGroupTax, GroupTaxQuerySchema } from '@/lib/group/get-group-tax.service'

/**
 * GET /api/group/tax?companyId=&fiscalYearId=: the impôt sur les sociétés of
 * each company of the group, the régime mère-fille between them and the
 * simulation of an intégration fiscale (indicative, read only; typed
 * retraitements in cents as query parameters). reports:read in the holding
 * and in each subsidiary read; a subsidiary the user cannot read is counted,
 * never read, and stays out of the simulation.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] }, query: GroupTaxQuerySchema }, async ({ companyId, user, query }) =>
  NextResponse.json(await getGroupTax(companyId, query, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
