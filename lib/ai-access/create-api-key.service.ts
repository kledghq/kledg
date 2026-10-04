/**
 * Creates an API key together with its company grant, so a key restricted to
 * some companies is never usable with more than that: if the grant cannot be
 * saved (a company the user cannot access), the key is deleted again before
 * its value is ever shown.
 */

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { CurrentUser } from '@/lib/session'
import {
  DEFAULT_EXECUTION_MODE,
  apiKeyPermissionsFor,
  type AccessLevel,
  type CompanyAccess,
  type ExecutionMode,
} from '@/lib/ai-access/access'
import { setGrant } from '@/lib/ai-access/manage-grants.service'

export interface CreatedApiKey {
  id: string
  /** The secret, returned once. */
  key: string
  name: string | null
  start: string | null
  access: CompanyAccess
  level: AccessLevel
  /** How full control runs high-impact tools (stored on the grant; 'automatic' by default). */
  executionMode: ExecutionMode
}

export async function createApiKeyWithGrant(
  user: CurrentUser,
  name: string,
  access: CompanyAccess,
  level: AccessLevel,
  executionMode: ExecutionMode = DEFAULT_EXECUTION_MODE,
): Promise<CreatedApiKey> {
  // Server-side call: the key belongs to `userId` (no session cookie involved).
  // Its level is stored as Better Auth key permissions (server-only field).
  const created = await auth.api.createApiKey({ body: { name, userId: user.id, permissions: apiKeyPermissionsFor(level) } })
  try {
    const { executionMode: mode, ...saved } = await setGrant(user, { kind: 'apiKey', apiKeyId: created.id }, access, executionMode)
    return {
      id: created.id,
      key: created.key,
      name: created.name ?? null,
      start: created.start ?? null,
      access: saved,
      level,
      executionMode: mode,
    }
  } catch (error) {
    await prisma.apikey.delete({ where: { id: created.id } })
    throw error
  }
}
