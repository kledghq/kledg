import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authedRoute } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import { auth } from '@/lib/auth'
import { callAuth } from '@/lib/account/auth-errors'
import { enforceRateLimit } from '@/lib/rate-limit'
import { decideAction } from '@/lib/mcp/full-control/pending-actions'

const DecisionSchema = z.object({
  decision: z.enum(['approve', 'reject'], { error: 'Choisissez Approuver ou Refuser.' }),
  /** The user's password, typed again: an open session alone does not approve what an assistant prepared. */
  password: z.string().min(1, 'Saisissez votre mot de passe').max(200),
})

/**
 * POST /api/ai-actions/[id] { decision, password }: the user approves or
 * refuses a high-impact action an assistant prepared
 * (lib/mcp/full-control/pending-actions.ts). Session cookie only: MCP
 * tokens and API keys never authenticate here, so an assistant cannot
 * approve its own action. Same origin and JSON only (route wrapper),
 * password checked again, rate limited, audited.
 */
export const POST = authedRoute({ body: DecisionSchema }, async ({ request, params, user, body }) => {
  await enforceRateLimit('ai-action-approval', user.id)
  await callAuth(() => auth.api.verifyPassword({ headers: request.headers, body: { password: body.password } }))
  const decided = await decideAction(user.id, params.id as string, body.decision)
  await writeAuditLog(decided.status === 'approved' ? 'info' : 'warn', `MCP action ${decided.status}: ${decided.tool}`, {
    action: decided.status === 'approved' ? 'MCP_ACTION_APPROVED' : 'MCP_ACTION_REJECTED',
    companyId: decided.companyId ?? undefined,
    metadata: { actionId: decided.id, tool: decided.tool, userId: user.id },
  })
  return NextResponse.json({ id: decided.id, status: decided.status })
})
