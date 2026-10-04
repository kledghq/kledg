import { companyRoute, NextResponse } from '@/lib/api/route'
import { fromRevolutState } from '@/lib/api/bank-resolvers'
import { getAppUrl } from '@/lib/config'
import {
  finishRevolutConsent,
  REVOLUT_STATE_COOKIE,
  RevolutCallbackQuerySchema,
  type RevolutConsentOutcome,
} from '@/lib/banking/revolut-connection.service'

export const dynamic = 'force-dynamic'

/** Back to the Revolut setup page of the company, on this instance only. */
function backToSetup(companyId: string, status: RevolutConsentOutcome): NextResponse {
  const url = new URL(`/${encodeURIComponent(companyId)}/banking/connect/revolut`, getAppUrl())
  url.searchParams.set('status', status)
  const response = NextResponse.redirect(url, 303)
  response.cookies.delete({ name: REVOLUT_STATE_COOKIE, path: '/api/banking/revolut/callback' })
  return response
}

/**
 * GET /api/banking/revolut/callback?code=&state=
 * OAuth redirect URI entered in Revolut Business. Requires the session of
 * the user who started the consent, with the banking manage permission. The
 * browser always goes back to the setup page (finishRevolutConsent), except
 * for a state that does not match this user's consent (403).
 */
export const GET = companyRoute(
  { company: fromRevolutState, permission: { banking: ['manage'] }, query: RevolutCallbackQuerySchema },
  async ({ request, query, companyId, user }) => {
    const outcome = await finishRevolutConsent({
      companyId,
      userId: user.id,
      code: query.code,
      state: query.state,
      cookieState: request.cookies.get(REVOLUT_STATE_COOKIE)?.value ?? null,
    })
    return backToSetup(companyId, outcome)
  },
)
