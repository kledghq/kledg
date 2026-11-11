import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authedRoute } from '@/lib/api/route'
import { CompanyAccessSchema, ExecutionModeSchema } from '@/lib/ai-access/access'
import { setGrant } from '@/lib/ai-access/manage-grants.service'
import { assertCurrentPassword } from '@/lib/account/confirm-password'
import { enforceRateLimit } from '@/lib/rate-limit'
import { writeAuditLog } from '@/lib/audit'

const Body = z.object({
  // A registered client id, or a client metadata document URL (CIMD).
  clientId: z.string().min(1).max(2048),
  access: CompanyAccessSchema,
  // How full control runs high-impact tools; kept when absent ('automatic' for a new grant).
  executionMode: ExecutionModeSchema.optional(),
  /** The consent page gives full control: recorded only with the password (KLEDG-R3-AUTH-01). */
  fullControl: z.boolean().optional(),
  /** The user's password, typed again: for full control, and to leave validation mode. */
  password: z.string().max(200).optional(),
})

/**
 * Sets which companies an assistant (OAuth client) may reach for the
 * signed-in user, and how it runs high-impact full control tools. Called by the consent page just before the user approves,
 * and from the settings page. The grant belongs to the user: it can only
 * narrow their own access.
 */
export const PUT = authedRoute({ body: Body }, async ({ user, body }) => {
  if (body.password) {
    await enforceRateLimit('api-key-full-control', user.id)
    await assertCurrentPassword(user.id, body.password)
  }
  const access = await setGrant(user, { kind: 'oauth', clientId: body.clientId }, body.access, body.executionMode, {
    passwordChecked: Boolean(body.password),
    fullControl: body.fullControl,
  })
  await writeAuditLog('info', 'AI assistant access updated', {
    action: 'UPDATE_AI_ACCESS_GRANT',
    metadata: { clientId: body.clientId, userId: user.id, ...access },
  })
  return NextResponse.json(access)
})
