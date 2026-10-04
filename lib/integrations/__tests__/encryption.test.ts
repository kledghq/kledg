import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from '../encryption'

describe('Encryption', () => {
  // Generate a valid 64-character hex key (32 bytes)
  const validKey = 'a'.repeat(64)

  describe('encrypt', () => {
    it('should encrypt text successfully', () => {
      const text = 'sensitive data'
      const encrypted = encrypt(text, validKey)

      expect(encrypted).toBeTruthy()
      expect(encrypted).not.toBe(text)
      expect(typeof encrypted).toBe('string')
    })

    it('should throw error for invalid key length', () => {
      const invalidKey = 'short'
      expect(() => encrypt('text', invalidKey)).toThrow(
        'Encryption key must be 64 characters (32 bytes hex)'
      )
    })

    it('should throw error for empty key', () => {
      expect(() => encrypt('text', '')).toThrow(
        'Encryption key must be 64 characters (32 bytes hex)'
      )
    })

    it('should produce different encrypted values for same input', () => {
      const text = 'same text'
      const encrypted1 = encrypt(text, validKey)
      const encrypted2 = encrypt(text, validKey)

      // Due to random IV and salt, encrypted values should be different
      expect(encrypted1).not.toBe(encrypted2)
    })
  })

  describe('decrypt', () => {
    it('should decrypt encrypted text correctly', () => {
      const originalText = 'sensitive data'
      const encrypted = encrypt(originalText, validKey)
      const decrypted = decrypt(encrypted, validKey)

      expect(decrypted).toBe(originalText)
    })

    it('should throw error for invalid key length', () => {
      const encrypted = encrypt('text', validKey)
      const invalidKey = 'short'

      expect(() => decrypt(encrypted, invalidKey)).toThrow(
        'Encryption key must be 64 characters (32 bytes hex)'
      )
    })

    it('should throw error for wrong key', () => {
      const originalText = 'sensitive data'
      const encrypted = encrypt(originalText, validKey)
      const wrongKey = 'b'.repeat(64)

      expect(() => decrypt(encrypted, wrongKey)).toThrow()
    })

    it('should handle empty string', () => {
      const encrypted = encrypt('', validKey)
      const decrypted = decrypt(encrypted, validKey)

      expect(decrypted).toBe('')
    })

    it('should handle special characters', () => {
      const text = 'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?'
      const encrypted = encrypt(text, validKey)
      const decrypted = decrypt(encrypted, validKey)

      expect(decrypted).toBe(text)
    })

    it('should handle unicode characters', () => {
      const text = 'Unicode: 你好世界 🌍 émojis 🎉'
      const encrypted = encrypt(text, validKey)
      const decrypted = decrypt(encrypted, validKey)

      expect(decrypted).toBe(text)
    })

    it('should handle long text', () => {
      const text = 'a'.repeat(10000)
      const encrypted = encrypt(text, validKey)
      const decrypted = decrypt(encrypted, validKey)

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
        const encrypted = encrypt(text, validKey)
        const decrypted = decrypt(encrypted, validKey)
        expect(decrypted).toBe(text)
      })
    })
  })
})
