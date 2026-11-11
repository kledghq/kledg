import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authedRoute } from '@/lib/api/route'
import { CompanyAccessSchema, ExecutionModeSchema } from '@/lib/ai-access/access'
import { setGrant } from '@/lib/ai-access/manage-grants.service'
import { assertCurrentPassword } from '@/lib/account/confirm-password'
import { enforceRateLimit } from '@/lib/rate-limit'
import { writeAuditLog } from '@/lib/audit'

// executionMode is kept when absent; leaving validation mode needs the password (KLEDG-R3-AUTH-01).
const Body = z.object({ access: CompanyAccessSchema, executionMode: ExecutionModeSchema.optional(), password: z.string().max(200).optional() })

/** Changes which companies an API key of the signed-in user may reach and its execution mode (404 for a key of someone else). */
export const PUT = authedRoute({ body: Body }, async ({ user, params, body }) => {
  const apiKeyId = String(params.id)
  if (body.password) {
    await enforceRateLimit('api-key-full-control', user.id)
    await assertCurrentPassword(user.id, body.password)
  }
  const access = await setGrant(user, { kind: 'apiKey', apiKeyId }, body.access, body.executionMode, { passwordChecked: Boolean(body.password) })
  await writeAuditLog('info', 'API key access updated', {
    action: 'UPDATE_AI_ACCESS_GRANT',
    metadata: { apiKeyId, userId: user.id, ...access },
  })
  return NextResponse.json(access)
})
