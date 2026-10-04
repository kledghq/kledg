import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfExpenseClaimant } from '@/lib/api/resources'
import { deleteClaimant, UpdateClaimantBodySchema, updateClaimant } from '@/lib/expense-reports/manage-expense-claimants.service'

/** PATCH /api/expense-claimants/[id]: kind, name, links, account; the auxiliary number is fixed once a report is posted. */
export const PATCH = companyRoute(
  { company: fromResource(companyOfExpenseClaimant), permission: { expenses: ['validate'] }, body: UpdateClaimantBodySchema },
  async ({ companyId, params, body }) => NextResponse.json(await updateClaimant(companyId, params.id as string, body)),
)

/** DELETE /api/expense-claimants/[id]: only a claimant without reports (409 otherwise). */
export const DELETE = companyRoute(
  { company: fromResource(companyOfExpenseClaimant), permission: { expenses: ['validate'] } },
  async ({ companyId, params }) => {
    await deleteClaimant(companyId, params.id as string)
    return new NextResponse(null, { status: 204 })
  },
)
