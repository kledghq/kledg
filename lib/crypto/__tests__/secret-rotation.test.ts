/**
 * Rotation of the auth secret (lib/crypto/encryption-key.ts, reencrypt.ts):
 * - the current key comes from the first BETTER_AUTH_SECRETS entry, the way
 *   Better Auth picks its signing secret, else from BETTER_AUTH_SECRET, and
 *   an instance that never rotated keeps its key;
 * - the older secrets only yield keys for re-encryption, never the current one;
 * - a value sealed with an older key is sealed again with the current one,
 *   a current value is left alone, and one no key opens is reported.
 */

import { describe, expect, it } from 'vitest'
import { decrypt, encrypt } from '@/lib/integrations/encryption'

const CTX = 'bank_connections:company-1:QONTO:secretKeyEncrypted'
import { getEncryptionKey, previousEncryptionKeys } from '@/lib/crypto/encryption-key'
import { reseal } from '@/lib/crypto/reencrypt'

const OLD = 'old-secret-0123456789abcdefghijklmnopqrstuvwxyz'
const NEW = 'new-secret-0123456789abcdefghijklmnopqrstuvwxyz'

describe('encryption keys', () => {
  it('keeps the key of an instance that never rotated', () => {
    const before = getEncryptionKey({ BETTER_AUTH_SECRET: OLD })
    expect(before).toMatch(/^[0-9a-f]{64}$/)
    expect(previousEncryptionKeys({ BETTER_AUTH_SECRET: OLD })).toEqual([])
  })

  it('uses the first BETTER_AUTH_SECRETS entry as current, the others and BETTER_AUTH_SECRET as previous', () => {
    const oldKey = getEncryptionKey({ BETTER_AUTH_SECRET: OLD })
    const newKey = getEncryptionKey({ BETTER_AUTH_SECRET: NEW })
    const env = { BETTER_AUTH_SECRETS: `2:${NEW}`, BETTER_AUTH_SECRET: OLD }
    expect(getEncryptionKey(env)).toBe(newKey)
    expect(previousEncryptionKeys(env)).toEqual([oldKey])
    expect(previousEncryptionKeys({ BETTER_AUTH_SECRETS: `2:${NEW},1:${OLD}` })).toEqual([oldKey])
  })

  it('lets ENCRYPTION_KEY win, with nothing to rotate', () => {
    const env = { ENCRYPTION_KEY: 'a'.repeat(64), BETTER_AUTH_SECRETS: `2:${NEW},1:${OLD}` }
    expect(getEncryptionKey(env)).toBe('a'.repeat(64))
    expect(previousEncryptionKeys(env)).toEqual([])
  })
})

describe('reseal', () => {
  const oldKey = getEncryptionKey({ BETTER_AUTH_SECRET: OLD })!
  const newKey = getEncryptionKey({ BETTER_AUTH_SECRET: NEW })!

  it('seals again with the current key a value only an older key opens', () => {
    const outcome = reseal(encrypt('qonto-secret', oldKey, CTX), newKey, [oldKey], CTX)
    expect(outcome.kind).toBe('resealed')
    if (outcome.kind === 'resealed') expect(decrypt(outcome.value, newKey, CTX)).toBe('qonto-secret')
  })

  it('[KLEDG-R3-INPUT-06] seals again in v2, bound to its row, a legacy value the current key opens', async () => {
    const crypto = await import('crypto')
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(newKey, 'hex'), iv)
    const body = Buffer.concat([cipher.update('qonto-secret', 'utf8'), cipher.final()])
    const legacy = Buffer.concat([crypto.randomBytes(64), iv, cipher.getAuthTag(), body]).toString('base64')
    const outcome = reseal(legacy, newKey, [], CTX)
    expect(outcome.kind).toBe('resealed')
    if (outcome.kind === 'resealed') {
      expect(outcome.value.startsWith('v2:')).toBe(true)
      expect(decrypt(outcome.value, newKey, CTX)).toBe('qonto-secret')
      expect(reseal(outcome.value, newKey, [], CTX)).toEqual({ kind: 'current' })
    }
  })

  it('leaves a value sealed with the current key alone', () => {
    expect(reseal(encrypt('qonto-secret', newKey, CTX), newKey, [oldKey], CTX)).toEqual({ kind: 'current' })
  })

  it('reports a value no configured key opens', () => {
    expect(reseal(encrypt('qonto-secret', 'b'.repeat(64), CTX), newKey, [oldKey], CTX)).toEqual({ kind: 'unreadable' })
    // Sealed for another row: unreadable here
    expect(reseal(encrypt('qonto-secret', newKey, 'elsewhere'), newKey, [oldKey], CTX)).toEqual({ kind: 'unreadable' })
  })
})
