import { NextResponse } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { writeAuditLog } from '@/lib/audit'
import { currentSessionId, revokeSession } from '@/lib/account/sessions.service'

/** Signs out one other session of the signed-in user (404 for sessions of other users). */
export const DELETE = authedRoute({}, async ({ request, params, user }) => {
  assertSameOrigin(request)
  const sessionId = params.id as string
  await revokeSession(user.id, await currentSessionId(request.headers), sessionId)
  await writeAuditLog('info', 'Session revoked', { action: 'REVOKE_SESSION', metadata: { userId: user.id, sessionId } })
  return new NextResponse(null, { status: 204 })
})
