import type { NextRequest } from 'next/server'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { assertActionAllowed, type InstanceActor } from '@/lib/instance'
import { enforceRateLimit } from '@/lib/rate-limit'

/**
 * Guard of the routes that connect a bank (they call the provider and store
 * credentials): allowed by the instance policy, same origin only, rate limited.
 */
export async function guardBankConnect(request: NextRequest, companyId: string, user: InstanceActor): Promise<void> {
  await assertActionAllowed('connect-bank', user)
  assertSameOrigin(request)
  await limitBankCalls(companyId)
}

/** Rate limit of user triggered bank API calls (connect, refresh). */
export async function limitBankCalls(companyId: string): Promise<void> {
  await enforceRateLimit('bank-api', companyId)
}
