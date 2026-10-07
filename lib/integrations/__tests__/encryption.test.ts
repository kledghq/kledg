import crypto from 'crypto'
import { describe, it, expect } from 'vitest'
import { bankConnectionContext, decrypt, encrypt, integrationContext, isLegacySealed } from '../encryption'

const CTX = integrationContext('company-1', 'QONTO', 'secretKey')

/** The format written before v2: base64(salt 64, iv 16, tag 16, ciphertext), no additional data. */
function legacyEncrypt(text: string, hexKey: string): string {
  const iv = crypto.randomBytes(16)
  const salt = crypto.randomBytes(64)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]).toString('base64')
}

describe('Encryption', () => {
  // Generate a valid 64-character hex key (32 bytes)
  const validKey = 'a'.repeat(64)

  describe('encrypt', () => {
    it('should encrypt text successfully', () => {
      const text = 'sensitive data'
      const encrypted = encrypt(text, validKey, CTX)

      expect(encrypted).toBeTruthy()
      expect(encrypted).not.toBe(text)
      expect(typeof encrypted).toBe('string')
    })

    it('should throw error for invalid key length', () => {
      const invalidKey = 'short'
      expect(() => encrypt('text', invalidKey, CTX)).toThrow(
        'Encryption key must be 64 characters (32 bytes hex)'
      )
    })

    it('should throw error for empty key', () => {
      expect(() => encrypt('text', '', CTX)).toThrow(
        'Encryption key must be 64 characters (32 bytes hex)'
      )
    })

    it('should produce different encrypted values for same input', () => {
      const text = 'same text'
      const encrypted1 = encrypt(text, validKey, CTX)
      const encrypted2 = encrypt(text, validKey, CTX)

      // Due to random IV and salt, encrypted values should be different
      expect(encrypted1).not.toBe(encrypted2)
    })
  })

  describe('decrypt', () => {
    it('should decrypt encrypted text correctly', () => {
      const originalText = 'sensitive data'
      const encrypted = encrypt(originalText, validKey, CTX)
      const decrypted = decrypt(encrypted, validKey, CTX)

      expect(decrypted).toBe(originalText)
    })

    it('should throw error for invalid key length', () => {
      const encrypted = encrypt('text', validKey, CTX)
      const invalidKey = 'short'

      expect(() => decrypt(encrypted, invalidKey, CTX)).toThrow(
        'Encryption key must be 64 characters (32 bytes hex)'
      )
    })

    it('should throw error for wrong key', () => {
      const originalText = 'sensitive data'
      const encrypted = encrypt(originalText, validKey, CTX)
      const wrongKey = 'b'.repeat(64)

      expect(() => decrypt(encrypted, wrongKey, CTX)).toThrow()
    })

    it('should handle empty string', () => {
      const encrypted = encrypt('', validKey, CTX)
      const decrypted = decrypt(encrypted, validKey, CTX)

      expect(decrypted).toBe('')
    })

    it('should handle special characters', () => {
      const text = 'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?'
      const encrypted = encrypt(text, validKey, CTX)
      const decrypted = decrypt(encrypted, validKey, CTX)

      expect(decrypted).toBe(text)
    })

    it('should handle unicode characters', () => {
      const text = 'Unicode: 你好世界 🌍 émojis 🎉'
      const encrypted = encrypt(text, validKey, CTX)
      const decrypted = decrypt(encrypted, validKey, CTX)

      expect(decrypted).toBe(text)
    })

    it('should handle long text', () => {
      const text = 'a'.repeat(10000)
      const encrypted = encrypt(text, validKey, CTX)
      const decrypted = decrypt(encrypted, validKey, CTX)

      expect(decrypted).toBe(text)
    })
  })

  describe('encrypt/decrypt roundtrip', () => {
    it('should work for various data types', () => {
      const testCases = [
        'simple text',
        '123456',
        '{"json": "data"}',
        'multiline\ntext\nhere',
        '   whitespace   ',
      ]

      testCases.forEach((text) => {
        const encrypted = encrypt(text, validKey, CTX)
        const decrypted = decrypt(encrypted, validKey, CTX)
        expect(decrypted).toBe(text)
      })
    })
  })

  describe('[KLEDG-R3-INPUT-06] v2 format: full tag, bound to its row', () => {
    it('writes v2 values that open only with the same context', () => {
      const sealed = encrypt('qonto-secret', validKey, CTX)
      expect(sealed.startsWith('v2:')).toBe(true)
      expect(isLegacySealed(sealed)).toBe(false)
      expect(decrypt(sealed, validKey, CTX)).toBe('qonto-secret')
      // Moved to another company, provider, field or table: refused
      for (const other of [
        integrationContext('company-2', 'QONTO', 'secretKey'),
        integrationContext('company-1', 'PONTO', 'secretKey'),
        integrationContext('company-1', 'QONTO', 'login'),
        bankConnectionContext('company-1', 'QONTO'),
        '',
      ]) {
        expect(() => decrypt(sealed, validKey, other), other).toThrow()
      }
    })

    it('still opens values sealed in the legacy format, whatever the context', () => {
      const legacy = legacyEncrypt('old-secret', validKey)
      expect(isLegacySealed(legacy)).toBe(true)
      expect(decrypt(legacy, validKey, CTX)).toBe('old-secret')
      expect(() => decrypt(legacy, 'b'.repeat(64), CTX)).toThrow()
    })

    it('refuses a truncated value instead of checking a shorter tag', () => {
      const legacy = Buffer.from(legacyEncrypt('', validKey), 'base64')
      // Ciphertext empty: dropping bytes shortens the tag (Node would accept a 4 byte tag without authTagLength)
      for (const cut of [1, 8, 12]) {
        expect(() => decrypt(legacy.subarray(0, legacy.length - cut).toString('base64'), validKey, CTX)).toThrow()
      }
      const v2 = Buffer.from(encrypt('', validKey, CTX).slice(3), 'base64')
      for (const cut of [1, 8, 12]) {
        expect(() => decrypt('v2:' + v2.subarray(0, v2.length - cut).toString('base64'), validKey, CTX)).toThrow()
      }
    })

    it('refuses a tampered v2 value', () => {
      const raw = Buffer.from(encrypt('qonto-secret', validKey, CTX).slice(3), 'base64')
      raw[raw.length - 1] ^= 1
      expect(() => decrypt('v2:' + raw.toString('base64'), validKey, CTX)).toThrow()
    })
  })
})
