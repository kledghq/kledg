import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import {
  getCompanyOnboarding,
  OnboardingActionSchema,
  setOnboardingDismissed,
} from '@/lib/onboarding/load-onboarding.service'

/**
 * "Démarrer" checklist of a company (lib/onboarding). Any member reads it
 * (the empty states of company pages use it); `canManage` tells whether the
 * user may act on it and hide it.
 */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { entries: ['read'] } },
  async ({ companyId, user, can }) =>
    NextResponse.json(await getCompanyOnboarding(companyId, { actor: user, canManage: can({ ledger: ['manage'] }) })),
)

/** Hides the checklist ("dismiss") or shows it again ("reopen"), for every member of the company. */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { ledger: ['manage'] }, body: OnboardingActionSchema },
  async ({ companyId, user, body }) => NextResponse.json(await setOnboardingDismissed(companyId, body.action, user)),
)
