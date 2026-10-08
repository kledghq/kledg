import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { companyOfExpenseReport } from '@/lib/api/resources'
import {
  listReimbursementCandidates,
  ReimburseBodySchema,
  reimburseExpenseReport,
} from '@/lib/expense-reports/expense-reimbursement.service'

/** GET /api/expense-reports/[id]/reimbursement: reconciled bank payments on the claimant's account that may reimburse the report. */
export const GET = companyRoute(
  { company: fromResource(companyOfExpenseReport), permission: { expenses: ['validate'], entries: ['read'] } },
  async ({ companyId, params }) => NextResponse.json(await listReimbursementCandidates(companyId, params.id as string), { headers: NO_CACHE_HEADERS }),
)

/** POST /api/expense-reports/[id]/reimbursement { entryLineIds }: letters the report with its reimbursement (the report becomes remboursée). */
export const POST = companyRoute(
  { company: fromResource(companyOfExpenseReport), permission: { expenses: ['validate'], entries: ['update'] }, body: ReimburseBodySchema },
  async ({ companyId, params, body }) => NextResponse.json(await reimburseExpenseReport(companyId, params.id as string, body.entryLineIds)),
)
