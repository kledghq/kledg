import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { routeActor } from '@/lib/expense-reports/actor'
import {
  CreateExpenseReportBodySchema,
  createExpenseReport,
  ListExpenseReportsQuerySchema,
  listExpenseReports,
} from '@/lib/expense-reports/manage-expense-reports.service'

/**
 * GET /api/expense-reports?companyId=&status=&mine=&claimantId=&search=&cursor=&limit=
 * Expense reports, latest period first, page by page ({ items, nextCursor }):
 * every report for a validator, one's own otherwise (mine=true: one's own only).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: ListExpenseReportsQuerySchema },
  async (ctx) => NextResponse.json(await listExpenseReports(ctx.companyId, routeActor(ctx), ctx.query), { headers: NO_CACHE_HEADERS }),
)

/** POST /api/expense-reports { companyId, claimantId?, periodStart, periodEnd, label?, lines }: a draft report, amounts computed here. */
export const POST = companyRoute(
  { company: fromBody(), permission: { expenses: ['submit'] }, body: CreateExpenseReportBodySchema },
  async (ctx) => NextResponse.json(await createExpenseReport(ctx.companyId, ctx.body, routeActor(ctx)), { status: 201 }),
)
