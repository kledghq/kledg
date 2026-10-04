import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfExpenseCategoryRule } from '@/lib/api/resources'
import { deleteCategoryRule, UpdateCategoryRuleBodySchema, updateCategoryRule } from '@/lib/expense-reports/manage-category-rules.service'

/** PATCH /api/expense-category-rules/[id] */
export const PATCH = companyRoute(
  { company: fromResource(companyOfExpenseCategoryRule), permission: { expenses: ['validate'] }, body: UpdateCategoryRuleBodySchema },
  async ({ companyId, params, body }) => NextResponse.json(await updateCategoryRule(companyId, params.id as string, body)),
)

/** DELETE /api/expense-category-rules/[id] */
export const DELETE = companyRoute(
  { company: fromResource(companyOfExpenseCategoryRule), permission: { expenses: ['validate'] } },
  async ({ companyId, params }) => {
    await deleteCategoryRule(companyId, params.id as string)
    return new NextResponse(null, { status: 204 })
  },
)
