/**
 * Public health check (GET /api/health): 200 when PostgreSQL answers, 503
 * otherwise, never the reason (it may name hosts or credentials). Reachable
 * without a session, and safe to hammer: concurrent and repeated calls share
 * one probe (lib/health/check-database.service.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { GET } from '../health/route'
import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { isDatabaseReachable, resetDatabaseProbe } from '@/lib/health/check-database.service'
import { proxy } from '@/proxy'

const db = asPrismaMock(prisma)

const SECRETS = {
  DATABASE_URL: 'postgresql://kledg:s3cr3t-db-password@db.internal:5432/kledg',
  BETTER_AUTH_SECRET: 'health-test-secret-0123456789abcdef',
  SETUP_TOKEN: 'health-test-setup-token-0123',
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDatabaseProbe()
    for (const [key, value] of Object.entries(SECRETS)) vi.stubEnv(key, value)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('answers ok, never cached, when the database answers', async () => {
    db.$queryRaw.mockResolvedValue([{ '?column?': 1 }])
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('answers 503 without the database error when it is unreachable', async () => {
    db.$queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432 user=kledg'))
    const response = await GET()
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ status: 'error', database: 'unreachable' })
    expect(text).not.toContain('ECONNREFUSED')
  })

  it('never returns a secret, a version or the environment', async () => {
    db.$queryRaw.mockResolvedValue([{ '?column?': 1 }])
    const text = await (await GET()).text()
    for (const value of Object.values(SECRETS)) expect(text).not.toContain(value)
    expect(text).not.toMatch(/version|commit|kledg/i)
  })

  it('answers 503 when the database hangs instead of waiting for it', async () => {
    vi.useFakeTimers()
    db.$queryRaw.mockReturnValue(new Promise(() => {}) as never)
    const pending = GET()
    await vi.advanceTimersByTimeAsync(4_000)
    expect((await pending).status).toBe(503)
  })

  it('shares one probe between concurrent calls and reuses it for a moment', async () => {
    let now = 1_000_000
    const clock = () => now
    db.$queryRaw.mockResolvedValue([{ '?column?': 1 }])
    const answers = await Promise.all(Array.from({ length: 50 }, () => isDatabaseReachable(clock)))
    expect(answers.every(Boolean)).toBe(true)
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)

    now += 1_000
    expect(await isDatabaseReachable(clock)).toBe(true)
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)

    // After the cache window, a new probe sees the database go down.
    now += 2_000
    db.$queryRaw.mockRejectedValue(new Error('down'))
    expect(await isDatabaseReachable(clock)).toBe(false)
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('is let through by the proxy without a session', async () => {
    const response = await proxy(new NextRequest('http://localhost/api/health'))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
    // Any other API route without a session is refused.
    expect((await proxy(new NextRequest('http://localhost/api/updates'))).status).toBe(401)
  })
})
