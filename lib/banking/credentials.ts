/**
 * Integration credentials at rest: secret fields are encrypted with the
 * instance key (lib/integrations/encryption.ts, AES-256-GCM), the other
 * fields stay readable (login, client id, certificate, timestamps).
 */

import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { decrypt, encrypt, integrationContext } from '@/lib/integrations/encryption'

/**
 * The instance key that seals bank credentials. Missing configuration is a
 * plain error: the route wrapper answers the generic 500 and logs it.
 */
export function requireEncryptionKey(): string {
  const key = getEncryptionKey()
  if (!key) throw new Error('Encryption key not configured (ENCRYPTION_KEY or BETTER_AUTH_SECRET)')
  return key
}

/** Fields encrypted at rest, per provider. */
export const SECRET_FIELDS: Record<string, readonly string[]> = {
  QONTO: ['secretKey'],
  PONTO: ['clientSecret'],
  REVOLUT: ['privateKey', 'refreshToken'],
}

/** Secret fields of a provider, defaulting to Qonto's `secretKey` for unknown providers. */
function secretFields(provider: string): readonly string[] {
  return SECRET_FIELDS[provider] ?? ['secretKey']
}

/**
 * Encrypts the secret fields of plain credentials. Empty secrets are left
 * out. Each value is bound to its company, provider and field
 * (integrationContext): copied elsewhere, it no longer opens.
 */
export function sealCredentials(
  provider: string,
  plain: Record<string, unknown>,
  encryptionKey: string,
  companyId: string,
): Record<string, unknown> {
  const sealed: Record<string, unknown> = { ...plain }
  for (const field of secretFields(provider)) {
    const value = plain[field]
    if (typeof value === 'string' && value.length > 0) sealed[field] = encrypt(value, encryptionKey, integrationContext(companyId, provider, field))
    else delete sealed[field]
  }
  return sealed
}

/**
 * Decrypts stored credentials. `encrypted` is Integration.credentialsEncrypted:
 * rows written before encryption was enforced hold plain values.
 */
export function openCredentials(
  provider: string,
  stored: unknown,
  encrypted: boolean,
  encryptionKey: string,
  companyId: string,
): Record<string, unknown> {
  const data = stored && typeof stored === 'object' ? { ...(stored as Record<string, unknown>) } : {}
  if (!encrypted) return data
  for (const field of secretFields(provider)) {
    const value = data[field]
    if (typeof value === 'string' && value.length > 0) data[field] = decrypt(value, encryptionKey, integrationContext(companyId, provider, field))
  }
  return data
}

/**
 * Merges new plain fields into stored (sealed) credentials, encrypting the
 * secret ones. Used to persist tokens and setup steps one at a time.
 */
export function mergeSealed(
  provider: string,
  stored: unknown,
  update: Record<string, unknown>,
  encryptionKey: string,
  companyId: string,
): Record<string, unknown> {
  const base = stored && typeof stored === 'object' ? { ...(stored as Record<string, unknown>) } : {}
  const secrets = new Set(secretFields(provider))
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) continue
    if (value === null) {
      delete base[key]
      continue
    }
    base[key] = secrets.has(key) && typeof value === 'string' ? encrypt(value, encryptionKey, integrationContext(companyId, provider, key)) : value
  }
  return base
}
