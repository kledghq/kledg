import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { CorporateTaxQuerySchema, loadCorporateTax } from '@/lib/corporate-tax/load-corporate-tax.service'
import { CORPORATE_TAX_READ } from '@/lib/corporate-tax/permissions'

/**
 * GET /api/companies/[id]/corporate-tax?fiscalYearId=&deadline=: the impôt sur les sociétés worksheet of a
 * fiscal year (the one due next by default). Kledg prepares, the user files on impots.gouv.fr. Subsidiaries
 * are read with the user's own role in each (parent-subsidiary regime).
 */
export const GET = companyRoute(
  { company: fromParam(), permission: CORPORATE_TAX_READ, query: CorporateTaxQuerySchema },
  async ({ companyId, query, user }) =>
    NextResponse.json(await loadCorporateTax(companyId, query, { access: userGroupAccess(user) }), { headers: NO_CACHE_HEADERS }),
)
