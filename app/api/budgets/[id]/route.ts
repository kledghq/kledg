import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { companyOfBudget } from '@/lib/api/resources'
import { deleteBudget, getBudget } from '@/lib/budgets/manage-budgets.service'

/** GET /api/budgets/[id]: the budget with its lines, amounts per month and recurring items. */
export const GET = companyRoute({ company: fromResource(companyOfBudget), permission: { reports: ['read'] } }, async ({ companyId, params }) =>
  NextResponse.json(await getBudget(companyId, params.id as string), { headers: NO_CACHE_HEADERS }),
)

/** DELETE /api/budgets/[id]: deletes the budget of an open fiscal year (409 once the year is closed). */
export const DELETE = companyRoute({ company: fromResource(companyOfBudget), permission: { budgets: ['manage'] } }, async ({ companyId, params }) => {
  await deleteBudget(companyId, params.id as string)
  return new NextResponse(null, { status: 204 })
})
