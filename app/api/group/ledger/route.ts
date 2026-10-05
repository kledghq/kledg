import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { getGroupLedger, GroupLedgerQuerySchema } from '@/lib/group/get-group-ledger.service'

/**
 * GET /api/group/ledger?companyId=&fiscalYearId=&prefix=&account=: the grand
 * livre combiné (an aggregation of the books, not a consolidation).
 * reports:read in the holding and in each subsidiary read.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: GroupLedgerQuerySchema },
  async ({ companyId, user, query }) => NextResponse.json(await getGroupLedger(companyId, query, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
