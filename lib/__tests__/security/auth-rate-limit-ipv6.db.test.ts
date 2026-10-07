/**
 * KLEDG-R3-CLOUD-07 (core, Better Auth endpoints): the sign-in limit counts
 * an IPv6 client per /64, so rotating addresses inside one prefix does not
 * reset it, and an IPv4-mapped address counts as its IPv4 address. Same
 * grouping as Kledg's own limits (rateLimitIpSubject, lib/client-ip.ts).
 *
 * Through the real Better Auth route handler against PostgreSQL, behind one
 * trusted proxy hop; skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('auth_rate_ipv6')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  delete process.env.RATE_LIMIT_DISABLED
  delete process.env.VERCEL
  delete process.env.RATE_LIMIT_IP_HEADER
  process.env.TRUST_PROXY_HOPS = '1'
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { rateLimitIpSubject } from '@/lib/client-ip'

const available = await testDatabaseAvailable()

describe('rateLimitIpSubject', () => {
  it('groups IPv6 per /64, maps IPv4-mapped addresses to IPv4, keeps IPv4', () => {
    expect(rateLimitIpSubject('2001:db8:1:2::1')).toBe(rateLimitIpSubject('2001:db8:1:2:ffff:ffff:ffff:fffe'))
    expect(rateLimitIpSubject('2001:db8:1:2::1')).not.toBe(rateLimitIpSubject('2001:db8:1:3::1'))
    expect(rateLimitIpSubject('::ffff:203.0.113.5')).toBe('203.0.113.5')
    expect(rateLimitIpSubject('203.0.113.5')).toBe('203.0.113.5')
  })
})

describe.skipIf(!available)('Better Auth sign-in limit per IPv6 /64', () => {
  let prisma: typeof import('@/lib/prisma').prisma
  let route: { POST: (request: Request) => Promise<Response> }

  beforeAll(async () => {
    ;({ prisma } = await import('@/lib/prisma'))
    route = (await import('@/app/api/auth/[...all]/route')) as unknown as typeof route
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('auth_rate_ipv6')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  function signIn(clientIp: string, i: number): Promise<Response> {
    return route.POST(
      new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': clientIp },
        body: JSON.stringify({ email: 'nobody@test.local', password: `guess-${i}-password` }),
      }),
    )
  }

  it('limits a /64 that rotates its addresses, and not the neighbouring /64', async () => {
    const statuses: number[] = []
    // 10 attempts per 5 minutes (lib/auth-policy.ts), each from another address of the same /64.
    for (let i = 1; i <= 11; i++) statuses.push((await signIn(`2001:db8:1:2::${i.toString(16)}`, i)).status)
    expect(statuses.slice(0, 10)).not.toContain(429)
    expect(statuses[10]).toBe(429)
    expect((await signIn('2001:db8:1:3::1', 12)).status).not.toBe(429)
  })

  it('counts an IPv4-mapped address as its IPv4 address', async () => {
    const statuses: number[] = []
    for (let i = 1; i <= 11; i++) statuses.push((await signIn(i % 2 ? '203.0.113.5' : '::ffff:203.0.113.5', i)).status)
    expect(statuses[10]).toBe(429)
    expect((await signIn('203.0.113.6', 12)).status).not.toBe(429)
  })
})
