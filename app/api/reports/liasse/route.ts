import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getLiasse, LiasseQuerySchema } from '@/lib/liasse/get-liasse.service'
import { userGroupAccess } from '@/lib/management-fees/access'

/**
 * GET /api/reports/liasse?companyId=&fiscalYearId=: the liasse fiscale of the company's regime, every table with
 * where Kledg prepares it, the tables prepared here box by box (computed or to fill by hand) and their checks.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] }, query: LiasseQuerySchema }, async ({ companyId, user, query }) =>
  NextResponse.json(await getLiasse(companyId, query.fiscalYearId, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
