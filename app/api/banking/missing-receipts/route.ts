import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { listMissingReceipts, MissingReceiptsQuerySchema } from '@/lib/banking/missing-receipts.service'

/**
 * GET /api/banking/missing-receipts?companyId=&fiscalYearId=&startDate=&endDate=&bankAccountId=&minAmount=&side=
 * Bank transactions at or above the threshold without a supporting
 * document (Code de commerce art. L123-22).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] }, query: MissingReceiptsQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await listMissingReceipts(companyId, query), { headers: NO_CACHE_HEADERS }),
)
