import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { SubscriptionDecisionBodySchema, decideSubscription } from '@/lib/subscriptions/decide-subscriptions.service'

/**
 * PUT /api/subscriptions/decision { companyId, subscriptionId, status }: confirms or ignores a
 * detected subscription, or forgets its decision (pending). 404 when the lines no longer show it.
 */
export const PUT = companyRoute(
  { company: fromBody(), permission: { banking: ['reconcile'] }, body: SubscriptionDecisionBodySchema },
  async ({ companyId, body }) => NextResponse.json(await decideSubscription(companyId, body)),
)
