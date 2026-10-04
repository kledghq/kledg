import { NextResponse } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { withAuthCookies } from '@/lib/api/auth-cookies'
import { writeAuditLog } from '@/lib/audit'
import { deleteAccount } from '@/lib/account/delete-account.service'
import { DeleteAccountSchema } from '@/lib/account/schemas'

/**
 * Deletes the signed-in user's account, confirmed by typing its email and
 * the password. Refused for the last administrator of the instance or of a
 * company. Companies and their books are kept.
 */
export const DELETE = authedRoute({ body: DeleteAccountSchema }, async ({ request, user, body }) => {
  assertSameOrigin(request)
  const authHeaders = await deleteAccount(user, request.headers, body)
  await writeAuditLog('info', 'Account deleted by its owner', {
    action: 'DELETE_ACCOUNT',
    metadata: { userId: user.id },
    context: { userId: user.id },
  })
  return withAuthCookies(NextResponse.json({ ok: true }), authHeaders)
})
