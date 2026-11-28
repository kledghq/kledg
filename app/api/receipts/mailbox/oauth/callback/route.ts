import { companyRoute, NextResponse } from '@/lib/api/route'
import { fromMailboxOAuthState } from '@/lib/api/receipt-resolvers'
import { getAppUrl } from '@/lib/config'
import { finishMailboxOAuth, MailboxOAuthCallbackSchema, type MailboxOAuthOutcome } from '@/lib/receipts/mailbox/mailbox.service'
import { MAILBOX_OAUTH_CALLBACK_PATH, MAILBOX_OAUTH_COOKIE } from '@/lib/receipts/mailbox/oauth'

export const dynamic = 'force-dynamic'

/** Back to the Justificatifs page of the company, on this instance only. */
function backToReceipts(companyId: string, outcome: MailboxOAuthOutcome): NextResponse {
  const url = new URL(`/${encodeURIComponent(companyId)}/banking/missing-receipts`, getAppUrl())
  url.searchParams.set('mailbox', outcome)
  const response = NextResponse.redirect(url, 303)
  response.cookies.delete({
    name: MAILBOX_OAUTH_COOKIE,
    path: MAILBOX_OAUTH_CALLBACK_PATH,
  })
  return response
}

/**
 * GET /api/receipts/mailbox/oauth/callback?code=&state=
 * The redirect URI registered at Google and Microsoft. Requires the session
 * of the user who started, with the company settings permission, and the
 * state cookie of this browser. Always goes back to the Justificatifs page
 * (?mailbox=connected|denied|error), except for a state that is not this
 * user's (403).
 */
export const GET = companyRoute(
  {
    company: fromMailboxOAuthState,
    permission: { settings: ['update'] },
    query: MailboxOAuthCallbackSchema,
  },
  async ({ request, query, companyId, user }) => {
    const outcome = await finishMailboxOAuth({
      companyId,
      userId: user.id,
      query,
      cookieState: request.cookies.get(MAILBOX_OAUTH_COOKIE)?.value ?? null,
    })
    return backToReceipts(companyId, outcome)
  },
)
