import { createHash } from 'crypto'

/**
 * Key used to encrypt integration credentials (bank API tokens) at rest.
 *
 * ENCRYPTION_KEY (64 hex chars) takes precedence. Without it, a key is derived
 * from BETTER_AUTH_SECRET so a fresh deployment needs one secret less.
 * Changing the source secret makes stored credentials unreadable: integrations
 * then have to be reconnected.
 */
export function getEncryptionKey(): string | undefined {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) return undefined
  return createHash('sha256').update(`kledg:integrations:${secret}`).digest('hex')
}
