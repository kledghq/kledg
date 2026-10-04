import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { companyOfExpenseReport } from '@/lib/api/resources'
import { routeActor } from '@/lib/expense-reports/actor'
import {
  deleteExpenseReport,
  getExpenseReport,
  UpdateExpenseReportBodySchema,
  updateExpenseReport,
} from '@/lib/expense-reports/manage-expense-reports.service'

/** GET /api/expense-reports/[id]: the report with its lines, recoverable VAT, entry and status (404 for another person's report unless validator). */
export const GET = companyRoute(
  { company: fromResource(companyOfExpenseReport), permission: { entries: ['read'] } },
  async (ctx) => NextResponse.json(await getExpenseReport(ctx.companyId, ctx.params.id as string, routeActor(ctx)), { headers: NO_CACHE_HEADERS }),
)

/** PATCH /api/expense-reports/[id]: edits a brouillon (its author or a validator) or a soumise (validator); 409 once validated. */
export const PATCH = companyRoute(
  { company: fromResource(companyOfExpenseReport), permission: { expenses: ['submit'] }, body: UpdateExpenseReportBodySchema },
  async (ctx) => NextResponse.json(await updateExpenseReport(ctx.companyId, ctx.params.id as string, ctx.body, routeActor(ctx))),
)

/** DELETE /api/expense-reports/[id]: deletes a report that is not posted (its author while it is a brouillon). */
export const DELETE = companyRoute(
  { company: fromResource(companyOfExpenseReport), permission: { expenses: ['submit'] } },
  async (ctx) => {
    await deleteExpenseReport(ctx.companyId, ctx.params.id as string, routeActor(ctx))
    return new NextResponse(null, { status: 204 })
  },
)
