import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { listReceiptOptions, ReceiptOptionsQuerySchema } from '@/lib/expense-reports/expense-receipts.service'

/** GET /api/expense-reports/receipts?companyId=&search=: receipts already in Kledg (Qonto attachments) a line can refer to. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { expenses: ['submit'], banking: ['read'] }, query: ReceiptOptionsQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await listReceiptOptions(companyId, query.search), { headers: NO_CACHE_HEADERS }),
)
