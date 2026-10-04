import { NextResponse } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { withAuthCookies } from '@/lib/api/auth-cookies'
import { writeAuditLog } from '@/lib/audit'
import { changePassword } from '@/lib/account/change-password.service'
import { ChangePasswordSchema } from '@/lib/account/schemas'

/** Changes the signed-in user's password (the current one is required). */
export const POST = authedRoute({ body: ChangePasswordSchema }, async ({ request, user, body }) => {
  assertSameOrigin(request)
  const authHeaders = await changePassword(user, request.headers, body)
  await writeAuditLog('info', 'Account password changed', {
    action: 'CHANGE_PASSWORD',
    metadata: { userId: user.id, revokedOtherSessions: body.revokeOtherSessions ?? true },
  })
  return withAuthCookies(NextResponse.json({ ok: true }), authHeaders)
})
