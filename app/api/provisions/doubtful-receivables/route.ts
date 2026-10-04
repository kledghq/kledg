import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { DoubtfulReceivablesQuerySchema, listDoubtfulReceivables } from '@/lib/provisions/doubtful-receivables.service'

/** GET /api/provisions/doubtful-receivables?companyId=&fiscalYearId=&minDaysOverdue=: customers overdue at the closing (aged balance). */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: DoubtfulReceivablesQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await listDoubtfulReceivables(companyId, query), { headers: NO_CACHE_HEADERS }),
)
