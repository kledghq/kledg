/**
 * Client IP of rate limits and audit entries (lib/client-ip.ts).
 *
 * Proxy headers are client input unless a proxy the operator configured
 * rewrites them: outside Vercel, X-Real-IP and X-Forwarded-For are trusted
 * only with TRUST_PROXY_HOPS (or RATE_LIMIT_IP_HEADER naming the header the
 * proxy sets). Otherwise every client shares one rate limit bucket, which
 * still stops a password guessing run that rotates forged headers.
 *
 * The last test signs in through the real Better Auth route handler against
 * PostgreSQL; skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('client_ip')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  delete process.env.RATE_LIMIT_DISABLED
  delete process.env.VERCEL
  delete process.env.TRUST_PROXY_HOPS
  delete process.env.RATE_LIMIT_IP_HEADER
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { CLIENT_IP_UNKNOWN, clientIpOrUnknown, rateLimitIpSubject, resolveClientIp } from '@/lib/client-ip'

const available = await testDatabaseAvailable()

const h = (init: Record<string, string>) => new Headers(init)

describe('resolveClientIp', () => {
  it('trusts no proxy header when no proxy is configured', () => {
    expect(resolveClientIp(h({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }), {})).toBeNull()
  })

  it('takes the address the outermost trusted proxy saw, never the forged left part', () => {
    const forged = h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9', 'x-real-ip': '6.6.6.6' })
    expect(resolveClientIp(forged, { TRUST_PROXY_HOPS: '1' })).toBe('203.0.113.9')
    expect(resolveClientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.2' }), { TRUST_PROXY_HOPS: '2' })).toBe('203.0.113.9')
    // Fewer hops than configured: the request bypassed the proxies.
    expect(resolveClientIp(h({ 'x-forwarded-for': '203.0.113.9' }), { TRUST_PROXY_HOPS: '2' })).toBeNull()
    expect(resolveClientIp(h({ 'x-forwarded-for': 'not-an-ip' }), { TRUST_PROXY_HOPS: '1' })).toBeNull()
  })

  it('uses the platform header on Vercel', () => {
    expect(resolveClientIp(h({ 'x-vercel-forwarded-for': '198.51.100.4', 'x-forwarded-for': '6.6.6.6' }), { VERCEL: '1' })).toBe('198.51.100.4')
  })

  it('uses the single header named by RATE_LIMIT_IP_HEADER', () => {
    expect(resolveClientIp(h({ 'cf-connecting-ip': '198.51.100.7', 'x-real-ip': '6.6.6.6' }), { RATE_LIMIT_IP_HEADER: 'CF-Connecting-IP' })).toBe('198.51.100.7')
  })
})

describe('rate limit subject of an address (KLEDG-R3-CLOUD-07)', () => {
  it('counts IPv6 addresses per /64 prefix, whatever their notation', () => {
    expect(rateLimitIpSubject('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64')
    expect(rateLimitIpSubject('2001:0db8:0001:0002::1')).toBe('2001:db8:1:2::/64')
    expect(rateLimitIpSubject('2001:DB8:1:2::ffff')).toBe('2001:db8:1:2::/64')
    expect(rateLimitIpSubject('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(rateLimitIpSubject('::1')).toBe('0:0:0:0::/64')
    expect(rateLimitIpSubject('2001:db8:1:3::1')).not.toBe(rateLimitIpSubject('2001:db8:1:2::1'))
  })

  it('keeps IPv4 addresses whole, IPv4-mapped ones included', () => {
    expect(rateLimitIpSubject('203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitIpSubject('::ffff:203.0.113.9')).toBe('203.0.113.9')
    expect(rateLimitIpSubject('::ffff:cb00:7109')).toBe('203.0.113.9')
  })

  it('is what clientIpOrUnknown answers', () => {
    expect(clientIpOrUnknown(h({ 'x-vercel-forwarded-for': '2001:db8:1:2::42' }), { VERCEL: '1' })).toBe('2001:db8:1:2::/64')
    expect(clientIpOrUnknown(h({}), { VERCEL: '1' })).toBe(CLIENT_IP_UNKNOWN)
  })
})

describe.skipIf(!available)('sign-in rate limit with forged proxy headers', () => {
  let prisma: typeof import('@/lib/prisma').prisma
  let route: { POST: (request: Request) => Promise<Response> }

  beforeAll(async () => {
    await prepareTestDatabase('client_ip')
    ;({ prisma } = await import('@/lib/prisma'))
    route = (await import('@/app/api/auth/[...all]/route')) as unknown as typeof route
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('client_ip')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('cannot be bypassed by rotating X-Real-IP or X-Forwarded-For', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      const response = await route.POST(
        new Request('http://localhost:3000/api/auth/sign-in/email', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            'x-real-ip': `10.9.8.${i}`,
            'x-forwarded-for': `10.9.7.${i}`,
          },
          body: JSON.stringify({ email: 'nobody@test.local', password: `guess-${i}-password` }),
        }),
      )
      statuses.push(response.status)
    }
    expect(statuses).toContain(429)
  })
})
