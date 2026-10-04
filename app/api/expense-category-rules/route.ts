import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { CategoryRuleBodySchema, createCategoryRule, listCategoryRules } from '@/lib/expense-reports/manage-category-rules.service'

/** GET /api/expense-category-rules?companyId=: keyword rules giving the category of expense lines (the editor applies them). */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] } },
  async ({ companyId }) => NextResponse.json(await listCategoryRules(companyId), { headers: NO_CACHE_HEADERS }),
)

/** POST /api/expense-category-rules { companyId, keyword, category, accountCode?, priority? } */
export const POST = companyRoute(
  { company: fromBody(), permission: { expenses: ['validate'] }, body: CategoryRuleBodySchema },
  async ({ companyId, body }) => NextResponse.json(await createCategoryRule(companyId, body), { status: 201 }),
)
