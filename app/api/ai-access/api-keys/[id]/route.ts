import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authedRoute } from '@/lib/api/route'
import { CompanyAccessSchema, ExecutionModeSchema } from '@/lib/ai-access/access'
import { setGrant } from '@/lib/ai-access/manage-grants.service'
import { writeAuditLog } from '@/lib/audit'

// executionMode is kept when absent.
const Body = z.object({ access: CompanyAccessSchema, executionMode: ExecutionModeSchema.optional() })

/** Changes which companies an API key of the signed-in user may reach and its execution mode (404 for a key of someone else). */
export const PUT = authedRoute({ body: Body }, async ({ user, params, body }) => {
  const apiKeyId = String(params.id)
  const access = await setGrant(user, { kind: 'apiKey', apiKeyId }, body.access, body.executionMode)
  await writeAuditLog('info', 'API key access updated', {
    action: 'UPDATE_AI_ACCESS_GRANT',
    metadata: { apiKeyId, userId: user.id, ...access },
  })
  return NextResponse.json(access)
})
