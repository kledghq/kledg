import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfExpenseReport } from '@/lib/api/resources'
import { postExpenseReport, unpostExpenseReport } from '@/lib/expense-reports/post-expense-report.service'

/**
 * POST /api/expense-reports/[id]/post: creates the draft entry of a validated
 * report (NDF or OD journal) in the fiscal year containing the end of its
 * period (lib/expense-reports/post-expense-report.service.ts).
 */
export const POST = companyRoute(
  { company: fromResource(companyOfExpenseReport), permission: { entries: ['create'] } },
  async ({ companyId, params }) => NextResponse.json(await postExpenseReport(companyId, params.id as string), { status: 201 }),
)

/** DELETE /api/expense-reports/[id]/post: deletes the draft entry, the report is validée again (409 once the entry is validated). */
export const DELETE = companyRoute(
  { company: fromResource(companyOfExpenseReport), permission: { entries: ['delete'] } },
  async ({ companyId, params }) => NextResponse.json(await unpostExpenseReport(companyId, params.id as string)),
)
