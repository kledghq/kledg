import { z } from 'zod'
import { companyRoute, fromBody, NextResponse } from '@/lib/api/route'
import { getAppUrl } from '@/lib/config'
import { enforceRateLimit } from '@/lib/rate-limit'
import { startMailboxOAuth } from '@/lib/receipts/mailbox/mailbox.service'
import { MAILBOX_OAUTH_CALLBACK_PATH, MAILBOX_OAUTH_COOKIE, MAILBOX_OAUTH_PROVIDERS, MAILBOX_OAUTH_TTL_SECONDS } from '@/lib/receipts/mailbox/oauth'

export const dynamic = 'force-dynamic'

const StartSchema = z.object({
  companyId: z.string().min(1),
  provider: z.enum(MAILBOX_OAUTH_PROVIDERS as [string, ...string[]], {
    message: 'Choisissez Google ou Microsoft.',
  }),
})

/**
 * POST /api/receipts/mailbox/oauth { companyId, provider }
 * Starts signing in to the receipt mailbox with a Google or Microsoft
 * account (lib/receipts/mailbox/oauth.ts): returns the consent URL. The
 * state is signed, bound to this user, and kept in an HttpOnly cookie that
 * only the callback reads. Company settings.
 */
export const POST = companyRoute(
  {
    company: fromBody(),
    permission: { settings: ['update'] },
    body: StartSchema,
  },
  async (ctx) => {
    await enforceRateLimit('mailbox-connect', ctx.companyId)
    const { url, state } = startMailboxOAuth(ctx.companyId, ctx.user.id, ctx.body.provider as 'google' | 'microsoft')
    const response = NextResponse.json({ url })
    response.cookies.set(MAILBOX_OAUTH_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: getAppUrl().startsWith('https://'),
      path: MAILBOX_OAUTH_CALLBACK_PATH,
      maxAge: MAILBOX_OAUTH_TTL_SECONDS,
    })
    return response
  },
)
