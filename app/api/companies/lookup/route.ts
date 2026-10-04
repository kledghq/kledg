import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authedRoute } from '@/lib/api/route'
import { assertCompanyCreationAllowed } from '@/lib/instance'
import { lookupSiren } from '@/lib/companies/lookup-siren.service'
import { normalizeSiren } from '@/lib/companies/siren-lookup'
import { enforceRateLimit } from '@/lib/rate-limit'

const SIREN_MESSAGE = 'Le SIREN compte exactement 9 chiffres.'

const Query = z.object({
  siren: z.string({ error: SIREN_MESSAGE }).transform((value, ctx) => {
    const siren = normalizeSiren(value)
    if (!siren) {
      ctx.addIssue({ code: 'custom', message: SIREN_MESSAGE })
      return z.NEVER
    }
    return siren
  }),
})

/**
 * Prefill of the company wizard from the public company directory
 * (lib/companies/lookup-siren.service.ts). Whoever may create a company
 * (instance administrators, or the users the instance policy allows). Always 200 with a status: "found", "not_found" or
 * "unavailable" (the wizard then lets the user type the information).
 */
export const GET = authedRoute({ query: Query }, async ({ query, user }) => {
  await assertCompanyCreationAllowed({ id: user.id, email: user.email, role: user.role })
  await enforceRateLimit('siren-lookup', user.id)
  return NextResponse.json(await lookupSiren(query.siren))
})
