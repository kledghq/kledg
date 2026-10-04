/**
 * MCP API key verification (lib/mcp/api-key.ts): Better Auth verifies a key
 * on first use and once a minute, the key row is only read in between, and
 * the per key rate limit is counted on every call.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  findUnique: vi.fn(),
  enforceRateLimit: vi.fn(async (_name: string, _subject: string) => {}),
}))

vi.mock('@/lib/auth', () => ({ auth: { api: { verifyApiKey: mocks.verifyApiKey } } }))
vi.mock('@/lib/prisma', () => ({ prisma: { apikey: { findUnique: mocks.findUnique } } }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.enforceRateLimit }))

import { RateLimitError } from '@/lib/accounting/errors'
import { clearVerifiedApiKeys, verifyMcpApiKey, VERIFIED_TTL_MS } from '../api-key'

const KEY = 'kledg_secret-key-value'
const NOW = Date.UTC(2026, 9, 3, 12)
const verifiedKey = { id: 'key-1', referenceId: 'u1', permissions: { kledg: ['read'] }, remaining: null }
const row = { id: 'key-1', referenceId: 'u1', permissions: '{"kledg":["read"]}', enabled: true, expiresAt: null, remaining: null }

beforeEach(() => {
  vi.clearAllMocks()
  clearVerifiedApiKeys()
  mocks.verifyApiKey.mockResolvedValue({ valid: true, key: verifiedKey })
  mocks.findUnique.mockResolvedValue(row)
})

describe('verifyMcpApiKey', () => {
  it('asks Better Auth on first use, then reads the key row until the minute has passed', async () => {
    expect(await verifyMcpApiKey(KEY, NOW)).toEqual({ id: 'key-1', referenceId: 'u1', permissions: { kledg: ['read'] } })
    expect(await verifyMcpApiKey(KEY, NOW + 1_000)).toEqual({ id: 'key-1', referenceId: 'u1', permissions: { kledg: ['read'] } })
    expect(mocks.verifyApiKey).toHaveBeenCalledTimes(1)
    expect(mocks.findUnique).toHaveBeenCalledTimes(1)

    await verifyMcpApiKey(KEY, NOW + VERIFIED_TTL_MS)
    expect(mocks.verifyApiKey).toHaveBeenCalledTimes(2)
  })

  it('counts every call against the per key rate limit and stops past it', async () => {
    await verifyMcpApiKey(KEY, NOW)
    await verifyMcpApiKey(KEY, NOW + 1)
    expect(mocks.enforceRateLimit.mock.calls).toEqual([
      ['mcp-api-key', 'key-1'],
      ['mcp-api-key', 'key-1'],
    ])
    mocks.enforceRateLimit.mockRejectedValueOnce(new RateLimitError('Trop'))
    await expect(verifyMcpApiKey(KEY, NOW + 2)).rejects.toBeInstanceOf(RateLimitError)
  })

  it('refuses at once a key deleted, disabled or expired since it was verified', async () => {
    await verifyMcpApiKey(KEY, NOW)
    mocks.findUnique.mockResolvedValueOnce({ ...row, enabled: false })
    expect(await verifyMcpApiKey(KEY, NOW + 1)).toBeNull()
    // Forgotten: the next call goes back to Better Auth
    mocks.verifyApiKey.mockResolvedValueOnce({ valid: false, key: null })
    expect(await verifyMcpApiKey(KEY, NOW + 2)).toBeNull()

    mocks.verifyApiKey.mockResolvedValue({ valid: true, key: verifiedKey })
    await verifyMcpApiKey(KEY, NOW + 3)
    mocks.findUnique.mockResolvedValueOnce({ ...row, expiresAt: new Date(NOW + 3) })
    expect(await verifyMcpApiKey(KEY, NOW + 4)).toBeNull()
    await verifyMcpApiKey(KEY, NOW + 5)
    mocks.findUnique.mockResolvedValueOnce(null)
    expect(await verifyMcpApiKey(KEY, NOW + 6)).toBeNull()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalledWith('mcp-api-key', expect.anything(), expect.anything())
  })

  it('leaves keys with a usage quota to Better Auth on every call', async () => {
    mocks.verifyApiKey.mockResolvedValue({ valid: true, key: { ...verifiedKey, remaining: 5 } })
    await verifyMcpApiKey(KEY, NOW)
    await verifyMcpApiKey(KEY, NOW + 1)
    expect(mocks.verifyApiKey).toHaveBeenCalledTimes(2)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('does not count a refused key', async () => {
    mocks.verifyApiKey.mockResolvedValue({ valid: false, key: null })
    expect(await verifyMcpApiKey(KEY, NOW)).toBeNull()
    expect(mocks.enforceRateLimit).not.toHaveBeenCalled()
  })
})
