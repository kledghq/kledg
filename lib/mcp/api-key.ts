/**
 * API key verification of the MCP endpoint, without a database write per
 * call for the key itself.
 *
 * Better Auth's verifyApiKey writes the key row on every call: its per key
 * rate limit counter (requestCount, lastRequest) and updatedAt, two UPDATEs
 * on the same row for each tool call of an assistant. None of its options
 * avoids that in database storage: with rate limiting off it still writes
 * lastRequest and updatedAt. So:
 *
 * - a key is verified by Better Auth the first time an instance sees it, and
 *   again once a minute (VERIFIED_TTL_MS): hash, enabled, expiry and
 *   permissions are Better Auth's checks, and lastRequest ("dernière
 *   utilisation" on the API keys page) stays current to the minute;
 * - in between, the key row is read by id (no write): a key deleted,
 *   disabled or expired is refused at once, like before;
 * - the rate limit, 300 calls per minute and per key, is counted on every
 *   call in the shared "rateLimit" table (enforceRateLimit('mcp-api-key')),
 *   so it holds exactly across serverless instances, as before. That upsert
 *   is the one write left: a shared limit cannot be counted without one.
 *
 * Keys with a usage quota (remaining) are verified by Better Auth on every
 * call, so the quota stays exact; Kledg does not create such keys.
 */

import { createHash } from 'crypto'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit } from '@/lib/rate-limit'

/** How long a key verified by Better Auth is trusted by this instance between two full verifications. */
export const VERIFIED_TTL_MS = 60_000
/** Bound of the in-process cache (keys of all users of the instance). */
const MAX_ENTRIES = 1_000

export interface VerifiedApiKey {
  id: string
  /** The user the key belongs to. */
  referenceId: string
  permissions: Record<string, string[]> | null
}

interface Entry {
  keyId: string
  verifiedAt: number
}

/** sha256 of the raw key: the cache never holds a usable key. */
const verified = new Map<string, Entry>()

const fingerprint = (key: string) => createHash('sha256').update(key).digest('base64url')

function parsePermissions(value: string | null): Record<string, string[]> | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : null
  } catch {
    return null
  }
}

/** The key row as it is now, if it may still be used (no write). */
async function currentKey(keyId: string, now: number): Promise<(VerifiedApiKey & { quota: boolean }) | null> {
  const row = await prisma.apikey.findUnique({
    where: { id: keyId },
    select: { id: true, referenceId: true, permissions: true, enabled: true, expiresAt: true, remaining: true },
  })
  if (!row || row.enabled === false) return null
  if (row.expiresAt && row.expiresAt.getTime() <= now) return null
  return { id: row.id, referenceId: row.referenceId, permissions: parsePermissions(row.permissions), quota: row.remaining !== null }
}

async function verifyWithBetterAuth(key: string, cacheKey: string, now: number): Promise<VerifiedApiKey | null> {
  const result = await auth.api.verifyApiKey({ body: { key } })
  const apiKey = result.valid ? result.key : null
  if (!apiKey) {
    verified.delete(cacheKey)
    return null
  }
  if (apiKey.remaining === null) {
    if (verified.size >= MAX_ENTRIES) verified.delete(verified.keys().next().value as string)
    verified.set(cacheKey, { keyId: apiKey.id, verifiedAt: now })
  }
  return { id: apiKey.id, referenceId: apiKey.referenceId, permissions: (apiKey.permissions ?? null) as Record<string, string[]> | null }
}

/**
 * The key's id, owner and permissions, or null when it is unknown, deleted,
 * disabled or expired. Throws RateLimitError (429) past 300 calls per
 * minute for this key.
 */
export async function verifyMcpApiKey(key: string, now: number = Date.now()): Promise<VerifiedApiKey | null> {
  const cacheKey = fingerprint(key)
  const entry = verified.get(cacheKey)
  let result: VerifiedApiKey | null
  if (entry && now - entry.verifiedAt < VERIFIED_TTL_MS) {
    const current = await currentKey(entry.keyId, now)
    if (!current) {
      verified.delete(cacheKey)
      result = null
    } else if (current.quota) {
      result = await verifyWithBetterAuth(key, cacheKey, now)
    } else {
      result = { id: current.id, referenceId: current.referenceId, permissions: current.permissions }
    }
  } else {
    result = await verifyWithBetterAuth(key, cacheKey, now)
  }
  if (result) await enforceRateLimit('mcp-api-key', result.id)
  return result
}

/** Forgets every verified key (tests). */
export function clearVerifiedApiKeys(): void {
  verified.clear()
}
