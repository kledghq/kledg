import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authedRoute } from '@/lib/api/route'
import { ValidationError } from '@/lib/accounting/errors'
import { waitUntil } from '@vercel/functions'
import { AccessLevelSchema, ApiKeyExpirySchema, CompanyAccessSchema, DEFAULT_API_KEY_EXPIRY_DAYS, describeLevel, ExecutionModeSchema } from '@/lib/ai-access/access'
import { createApiKeyWithGrant } from '@/lib/ai-access/create-api-key.service'
import { writeAuditLog } from '@/lib/audit'
import { assertCurrentPassword } from '@/lib/account/confirm-password'
import { enforceRateLimit } from '@/lib/rate-limit'
import { getAppUrl } from '@/lib/config'
import { sendEmail } from '@/lib/email'
import { apiKeyCreatedEmail } from '@/lib/email/templates'
import { logger } from '@/lib/logger'
import { formatIsoDateFr } from '@/lib/utils/date'

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
  /** Days before the key expires (30, 90, 365), or null for a read-only key without expiry (KLEDG-R3-AUTH-01). */
  expiresInDays: ApiKeyExpirySchema.default(DEFAULT_API_KEY_EXPIRY_DAYS),
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
  const created = await createApiKeyWithGrant(user, body.name, body.access, body.level, body.executionMode, body.expiresInDays)
  await writeAuditLog('info', 'API key created', {
    action: 'CREATE_API_KEY',
    metadata: { apiKeyId: created.id, userId: user.id, level: created.level, executionMode: created.executionMode, expiresAt: created.expiresAt, ...created.access },
  })
  // The owner hears of every new key (never its secret), after the response like the other account emails.
  const notice = apiKeyCreatedEmail(
    user.email,
    {
      name: created.name ?? body.name,
      access: describeLevel(created.level, created.executionMode),
      expiresOn: created.expiresAt ? formatIsoDateFr(created.expiresAt.toISOString().slice(0, 10)) : null,
    },
    `${getAppUrl()}/settings/api-keys`,
  )
  waitUntil(sendEmail(notice).catch((error: unknown) => logger.warn('API key notice could not be sent', error)))
  return NextResponse.json(created, { status: 201 })
})
