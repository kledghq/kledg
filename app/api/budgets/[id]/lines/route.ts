import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfBudget } from '@/lib/api/resources'
import { CreateBudgetLineBodySchema, createBudgetLine } from '@/lib/budgets/manage-budgets.service'

/** POST /api/budgets/[id]/lines { accountPrefix, label?, amounts?, recurringItems? }: a line on class 6 or 7 accounts. */
export const POST = companyRoute(
  { company: fromResource(companyOfBudget), permission: { budgets: ['manage'] }, body: CreateBudgetLineBodySchema },
  async ({ companyId, params, body }) => NextResponse.json(await createBudgetLine(companyId, params.id as string, body), { status: 201 }),
)
