import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { listReceiptOptions, ReceiptOptionsQuerySchema } from '@/lib/expense-reports/expense-receipts.service'
import { routeReceiptActor } from '@/lib/receipts/actor'

/**
 * GET /api/expense-reports/receipts?companyId=&search=: receipts already in Kledg a line can refer to
 * (a colleague's expense receipts only for a member who reconciles or validates).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { expenses: ['submit'], banking: ['read'] }, query: ReceiptOptionsQuerySchema },
  async (ctx) =>
    NextResponse.json(await listReceiptOptions(ctx.companyId, routeReceiptActor(ctx), ctx.query.search), { headers: NO_CACHE_HEADERS }),
)
