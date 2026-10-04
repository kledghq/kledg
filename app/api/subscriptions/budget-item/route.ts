import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { AddSubscriptionToBudgetBodySchema, addSubscriptionToBudget } from '@/lib/subscriptions/decide-subscriptions.service'

/**
 * POST /api/subscriptions/budget-item { companyId, subscriptionId, budgetLineId, label?, startMonth? }:
 * adds a detected subscription to a charges line of an open budget as a recurring item and confirms it.
 * Builds the budget (budgets:manage) and decides on the bank lines (banking:reconcile).
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { budgets: ['manage'] }, body: AddSubscriptionToBudgetBodySchema },
  async ({ companyId, body, authorize }) => {
    authorize({ banking: ['reconcile'] })
    return NextResponse.json(await addSubscriptionToBudget(companyId, body), { status: 201 })
  },
)
