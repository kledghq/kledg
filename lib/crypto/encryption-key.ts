import { createHash } from 'crypto'

type Env = Record<string, string | undefined>

/**
 * Key used to encrypt integration credentials (bank API tokens) and the
 * GitHub token of the updates page at rest.
 *
 * ENCRYPTION_KEY (64 hex chars) takes precedence. Without it, a key is derived
 * from the current auth secret, so a fresh deployment needs one secret less.
 *
 * The auth secret can be rotated the Better Auth way: BETTER_AUTH_SECRETS
 * lists versioned secrets, the current one first ("2:<new>,1:<old>"), and
 * BETTER_AUTH_SECRET may keep the previous value. The keys derived from the
 * older secrets are only used to re-encrypt what they sealed with the current
 * key (lib/crypto/reencrypt.ts, run at server start), so a leaked secret can
 * be replaced without reconnecting the banks.
 */
export function getEncryptionKey(env: Env = process.env): string | undefined {
  if (env.ENCRYPTION_KEY) return env.ENCRYPTION_KEY
  const secret = authSecrets(env)[0]
  return secret ? deriveKey(secret) : undefined
}

/** Keys derived from the auth secrets that are no longer current, for re-encryption only. */
export function previousEncryptionKeys(env: Env = process.env): string[] {
  if (env.ENCRYPTION_KEY) return []
  const current = getEncryptionKey(env)
  const keys = authSecrets(env).slice(1).map(deriveKey)
  return [...new Set(keys)].filter((key) => key !== current)
}

function deriveKey(secret: string): string {
  return createHash('sha256').update(`kledg:integrations:${secret}`).digest('hex')
}

/**
 * Auth secrets, current first: the BETTER_AUTH_SECRETS entries in their order
 * (Better Auth signs with the first one), then BETTER_AUTH_SECRET. Malformed
 * entries are skipped here: Better Auth itself refuses them at start.
 */
function authSecrets(env: Env): string[] {
  const secrets: string[] = []
  for (const entry of (env.BETTER_AUTH_SECRETS ?? '').split(',')) {
    const colon = entry.indexOf(':')
    const value = colon > 0 ? entry.slice(colon + 1).trim() : ''
    if (value) secrets.push(value)
  }
  const legacy = env.BETTER_AUTH_SECRET?.trim()
  if (legacy) secrets.push(legacy)
  return [...new Set(secrets)]
}
