import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { GroupTransactionsQuerySchema, listGroupTransactions } from '@/lib/group/list-group-transactions.service'

/**
 * GET /api/group/transactions?companyId=&company=&search=&side=&reconciled=&startDate=&endDate=&limit=&cursor=:
 * the bank transactions of the companies of the group, newest first, page
 * by page. reports:read in the holding and in each subsidiary read.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: GroupTransactionsQuerySchema },
  async ({ companyId, user, query }) => NextResponse.json(await listGroupTransactions(companyId, query, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)
