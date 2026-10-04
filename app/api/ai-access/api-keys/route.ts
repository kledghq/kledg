import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authedRoute } from '@/lib/api/route'
import { AccessLevelSchema, CompanyAccessSchema, ExecutionModeSchema } from '@/lib/ai-access/access'
import { createApiKeyWithGrant } from '@/lib/ai-access/create-api-key.service'
import { writeAuditLog } from '@/lib/audit'

const Body = z.object({
  // Better Auth's default maximum name length.
  name: z.string().trim().min(1).max(32),
  access: CompanyAccessSchema,
  // Read and drafts unless chosen otherwise; full control is always explicit.
  level: AccessLevelSchema.default('write'),
  // How full control runs high-impact tools: automatic unless validation is chosen (owner decision).
  executionMode: ExecutionModeSchema.default('automatic'),
})

/** Creates an API key of the signed-in user, limited to the chosen companies, level and execution mode. The secret is returned once. */
export const POST = authedRoute({ body: Body }, async ({ user, body }) => {
  const created = await createApiKeyWithGrant(user, body.name, body.access, body.level, body.executionMode)
  await writeAuditLog('info', 'API key created', {
    action: 'CREATE_API_KEY',
    metadata: { apiKeyId: created.id, userId: user.id, level: created.level, executionMode: created.executionMode, ...created.access },
  })
  return NextResponse.json(created, { status: 201 })
})
