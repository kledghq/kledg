import { z } from 'zod'
import { companyRoute, fromBody, NextResponse } from '@/lib/api/route'
import { guardBankConnect } from '@/lib/banking/guard'
import {
  REVOLUT_STATE_COOKIE,
  REVOLUT_STATE_TTL_SECONDS,
  startRevolutAuthorization,
} from '@/lib/banking/revolut-connection.service'
import { getAppUrl } from '@/lib/config'

export const dynamic = 'force-dynamic'

const authorizeSchema = z.object({
  companyId: z.string().min(1),
  clientId: z
    .string()
    .trim()
    .min(8, "Collez l'identifiant client (client ID) affiché par Revolut Business.")
    .max(200)
    .regex(/^[A-Za-z0-9._-]+$/, 'Identifiant client invalide.'),
})

/**
 * POST /api/banking/revolut/authorize { companyId, clientId }
 * Saves the client id and returns the Revolut consent URL. The OAuth state
 * is bound to this user (stored hash) and to this browser (HttpOnly cookie
 * read back by the callback).
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['manage'] }, body: authorizeSchema },
  async ({ request, companyId, user, body }) => {
    await guardBankConnect(request, companyId, user)
    const { url, state } = await startRevolutAuthorization(companyId, user.id, body.clientId)
    const response = NextResponse.json({ url })
    response.cookies.set(REVOLUT_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: getAppUrl().startsWith('https://'),
      path: '/api/banking/revolut/callback',
      maxAge: REVOLUT_STATE_TTL_SECONDS,
    })
    return response
  },
)
