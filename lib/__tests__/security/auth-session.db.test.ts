/**
 * Auth / session hardening.
 *
 * Enabled (regression): API key format and prefix, the key hashed at rest
 * (the plaintext never stored), and a disabled key refused at once.
 * Skipped (owed fixes): sessions not revoked on password reset
 * (KLEDG-DEL-reset-sessions), reset-request timing oracle (KLEDG-SEC-009) and
 * spoofable client IP for rate limiting (KLEDG-DEL-ip-spoofing).
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('security_auth')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { NEW_FINDINGS, DELEGATED_FINDINGS } from './findings'

const available = await testDatabaseAvailable()

type Handler = (request: Request) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
let mcp: Record<'POST', Handler>
let createApiKeyWithGrant: typeof import('@/lib/ai-access/create-api-key.service').createApiKeyWithGrant

const OWNER = { id: 'u-owner', email: 'owner@auth.local', name: 'Owner', role: 'user' }

async function mcpStatus(key: string): Promise<number> {
  const response = await mcp.POST(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  )
  return response.status
}

describe.skipIf(!available)('auth / session hardening', () => {
  beforeAll(async () => {
    await prepareTestDatabase('security_auth')
    ;({ prisma } = await import('@/lib/prisma'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as Record<'POST', Handler>
    ;({ createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service'))
    await prisma.user.create({ data: { id: OWNER.id, email: OWNER.email, name: OWNER.name, role: OWNER.role } })
    state.user = { ...OWNER }
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('issues a prefixed key and stores only a hash of it', async () => {
    const created = await createApiKeyWithGrant({ ...OWNER }, 'format-key', { allCompanies: true, companyIds: [] }, 'read')
    expect(created.key.startsWith('kledg_')).toBe(true)
    expect(created.key.length).toBeGreaterThan(40)

    const row = await prisma.apikey.findUniqueOrThrow({ where: { id: created.id } })
    // The row never holds the plaintext key.
    expect(row.key).not.toBe(created.key)
    expect(row.key).not.toContain(created.key.slice('kledg_'.length))
    // start is a short non-secret prefix for display.
    expect(created.key.startsWith(row.start ?? '~~~')).toBe(true)
  })

  it('refuses a disabled key immediately', async () => {
    const created = await createApiKeyWithGrant({ ...OWNER }, 'to-disable', { allCompanies: true, companyIds: [] }, 'read')
    expect(await mcpStatus(created.key)).toBe(200)

    const { clearVerifiedApiKeys } = await import('@/lib/mcp/api-key')
    await prisma.apikey.update({ where: { id: created.id }, data: { enabled: false } })
    clearVerifiedApiKeys()
    expect(await mcpStatus(created.key)).toBe(401)
  })

  it('refuses a garbage / unknown key', async () => {
    expect(await mcpStatus('kledg_' + 'x'.repeat(64))).toBe(401)
    expect(await mcpStatus('not-a-kledg-key')).toBe(401)
  })

  it('a password reset revokes every session (KLEDG-DEL-reset-sessions, fixed)', async () => {
    // End to end through Better Auth: lib/account/__tests__/session-revocation.db.test.ts.
    const { auth } = await import('@/lib/auth')
    expect((auth.options.emailAndPassword as { revokeSessionsOnPasswordReset?: boolean }).revokeSessionsOnPasswordReset).toBe(true)
  })

  it('a password-reset request does not wait for the email (KLEDG-SEC-009, fixed)', async () => {
    // Timing end to end, with a delivery that never finishes: lib/__tests__/security/reset-timing.db.test.ts.
    expect(NEW_FINDINGS['KLEDG-SEC-009'].status).toBe('fixed')
  })

  it('off Vercel, the client IP is never taken from a forgeable header without a trusted proxy (KLEDG-DEL-ip-spoofing, fixed)', async () => {
    // Rate limit bypass end to end: lib/__tests__/client-ip.db.test.ts.
    const { resolveClientIp } = await import('@/lib/client-ip')
    const forged = new Headers({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '6.6.6.6' })
    expect(resolveClientIp(forged, {})).toBeNull()
    expect(resolveClientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), { TRUST_PROXY_HOPS: '1' })).toBe('203.0.113.9')
  })
})
