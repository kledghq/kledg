import { NextResponse } from 'next/server'
import { adminRoute } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { writeAuditLog } from '@/lib/audit'
import { UpdateInstanceUserSchema } from '@/lib/users/schemas'
import {
  changeInstanceUserEmail,
  deleteInstanceUser,
  setInstanceUserBanned,
  setInstanceUserRole,
} from '@/lib/users/instance-users.service'

const AUDIT = {
  'set-role': { action: 'USER_ROLE_CHANGED', message: 'Instance user role changed' },
  ban: { action: 'USER_BANNED', message: 'Instance user banned' },
  unban: { action: 'USER_UNBANNED', message: 'Instance user unbanned' },
  'change-email': { action: 'USER_EMAIL_CHANGED', message: 'Instance user email changed by an administrator' },
} as const

/**
 * Instance administrators: change the role of an account, ban or unban it,
 * or change its email address (confirmed by the administrator's password).
 * Same origin only; the rules are in lib/users/instance-users.service.ts.
 */
export const PATCH = adminRoute({ body: UpdateInstanceUserSchema }, async ({ request, params, user, body }) => {
  assertSameOrigin(request)
  const userId = params.id as string
  switch (body.action) {
    case 'set-role':
      await setInstanceUserRole(user, request.headers, userId, body.role)
      break
    case 'ban':
    case 'unban':
      await setInstanceUserBanned(user, request.headers, userId, body.action === 'ban')
      break
    case 'change-email':
      await changeInstanceUserEmail(user, request.headers, userId, { email: body.email, password: body.password })
      break
  }
  const audit = AUDIT[body.action]
  await writeAuditLog('info', audit.message, {
    action: audit.action,
    metadata: { userId, by: user.id, ...(body.action === 'set-role' ? { role: body.role } : {}) },
    context: { userId: user.id },
  })
  return NextResponse.json({ ok: true })
})

/** Instance administrators: delete another account, with the guards of a self-deletion. */
export const DELETE = adminRoute({}, async ({ request, params, user }) => {
  assertSameOrigin(request)
  const userId = params.id as string
  await deleteInstanceUser(user, request.headers, userId)
  await writeAuditLog('info', 'Instance user deleted by an administrator', {
    action: 'USER_DELETED',
    metadata: { userId, by: user.id },
    context: { userId: user.id },
  })
  return new NextResponse(null, { status: 204 })
})
