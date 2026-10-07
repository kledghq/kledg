import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authedRoute } from '@/lib/api/route'
import { ValidationError } from '@/lib/accounting/errors'
import { AccessLevelSchema, CompanyAccessSchema, ExecutionModeSchema } from '@/lib/ai-access/access'
import { createApiKeyWithGrant } from '@/lib/ai-access/create-api-key.service'
import { writeAuditLog } from '@/lib/audit'
import { assertCurrentPassword } from '@/lib/account/confirm-password'
import { enforceRateLimit } from '@/lib/rate-limit'

const Body = z.object({
  // Better Auth's default maximum name length.
  name: z.string().trim().min(1).max(32),
  access: CompanyAccessSchema,
  // Read and drafts unless chosen otherwise; full control is always explicit.
  level: AccessLevelSchema.default('write'),
  // How full control runs high-impact tools: automatic unless validation is chosen (owner decision).
  executionMode: ExecutionModeSchema.default('automatic'),
  /** The user's password, typed again: required for full control (KLEDG-R3-AUTH-01). */
  password: z.string().max(200).optional(),
})

/**
 * Creates an API key of the signed-in user, limited to the chosen companies,
 * level and execution mode. The secret is returned once. A full control key
 * acts like the user and survives the browser session that created it until
 * the password changes, so an open session alone does not create one: the
 * password is typed again (KLEDG-R3-AUTH-01).
 */
export const POST = authedRoute({ body: Body }, async ({ user, body }) => {
  if (body.level === 'admin') {
    if (!body.password) throw new ValidationError('Saisissez votre mot de passe pour créer une clé à contrôle total.')
    await enforceRateLimit('api-key-full-control', user.id)
    await assertCurrentPassword(user.id, body.password)
  }
  const created = await createApiKeyWithGrant(user, body.name, body.access, body.level, body.executionMode)
  await writeAuditLog('info', 'API key created', {
    action: 'CREATE_API_KEY',
    metadata: { apiKeyId: created.id, userId: user.id, level: created.level, executionMode: created.executionMode, ...created.access },
  })
  return NextResponse.json(created, { status: 201 })
})
