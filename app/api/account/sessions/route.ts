import { NextResponse } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { writeAuditLog } from '@/lib/audit'
import { currentSessionId, listSessions, revokeOtherSessions } from '@/lib/account/sessions.service'

/** Active sessions of the signed-in user (no tokens), the current one first. */
export const GET = authedRoute({}, async ({ request, user }) => {
  return NextResponse.json(await listSessions(user.id, await currentSessionId(request.headers)))
})

/** Signs out every other session of the signed-in user. */
export const DELETE = authedRoute({}, async ({ request, user }) => {
  assertSameOrigin(request)
  const revoked = await revokeOtherSessions(user.id, await currentSessionId(request.headers))
  await writeAuditLog('info', 'Other sessions revoked', { action: 'REVOKE_OTHER_SESSIONS', metadata: { userId: user.id, revoked } })
  return NextResponse.json({ revoked })
})
