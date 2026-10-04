import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfBudgetLine } from '@/lib/api/resources'
import { deleteBudgetLine, UpdateBudgetLineBodySchema, updateBudgetLine } from '@/lib/budgets/manage-budgets.service'

/** PATCH /api/budget-lines/[id]: account, label; amounts and recurring items, when given, replace the line's. */
export const PATCH = companyRoute(
  { company: fromResource(companyOfBudgetLine), permission: { budgets: ['manage'] }, body: UpdateBudgetLineBodySchema },
  async ({ companyId, params, body }) => NextResponse.json(await updateBudgetLine(companyId, params.id as string, body)),
)

/** DELETE /api/budget-lines/[id] */
export const DELETE = companyRoute({ company: fromResource(companyOfBudgetLine), permission: { budgets: ['manage'] } }, async ({ companyId, params }) => {
  await deleteBudgetLine(companyId, params.id as string)
  return new NextResponse(null, { status: 204 })
})
