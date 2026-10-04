import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { CreateBudgetBodySchema, createBudget, listBudgets } from '@/lib/budgets/manage-budgets.service'

/** GET /api/budgets?companyId=: the budgets of the company, latest fiscal year first, with their annual totals. */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] } }, async ({ companyId }) =>
  NextResponse.json(await listBudgets(companyId), { headers: NO_CACHE_HEADERS }),
)

/** POST /api/budgets { companyId, fiscalYearId, template? }: the budget of an open fiscal year (409 when it has one). */
export const POST = companyRoute(
  { company: fromBody(), permission: { budgets: ['manage'] }, body: CreateBudgetBodySchema },
  async ({ companyId, body }) => NextResponse.json(await createBudget(companyId, body), { status: 201 }),
)
