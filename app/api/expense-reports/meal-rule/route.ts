import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { routeActor } from '@/lib/expense-reports/actor'
import { loadMealRule, MealRuleQuerySchema } from '@/lib/expense-reports/meal-rule.service'

/**
 * GET /api/expense-reports/meal-rule?companyId=&claimantId=&day=: whether a
 * meal alone of the claimant is split (company at IR, exploitant or
 * associé), so the line editor shows the split (docs/notes-de-frais.md).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { expenses: ['submit'] }, query: MealRuleQuerySchema },
  async (ctx) => NextResponse.json(await loadMealRule(ctx.companyId, routeActor(ctx), ctx.query), { headers: NO_CACHE_HEADERS }),
)
