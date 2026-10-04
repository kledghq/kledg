import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { companyOfBudget } from '@/lib/api/resources'
import { BudgetReportQuerySchema, getBudgetReport } from '@/lib/budgets/get-budget-report.service'

/** GET /api/budgets/[id]/report?throughMonth=yyyy-mm: budget against the validated entries, per line and per month. */
export const GET = companyRoute(
  { company: fromResource(companyOfBudget), permission: { reports: ['read'] }, query: BudgetReportQuerySchema },
  async ({ companyId, params, query }) => NextResponse.json(await getBudgetReport(companyId, params.id as string, query), { headers: NO_CACHE_HEADERS }),
)
