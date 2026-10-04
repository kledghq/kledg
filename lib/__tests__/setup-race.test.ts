/**
 * /setup must create exactly one administrator, even when several requests
 * race on a fresh instance, and always requires SETUP_TOKEN.
 * Runs against PostgreSQL (see helpers/test-db.ts); skipped without it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('setup')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
})

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-real-ip': '203.0.113.7' }),
}))

import { prepareTestDatabase, testDatabaseAvailable } from './helpers/test-db'

const available = await testDatabaseAvailable()

// Imported once the database exists: Better Auth queries it when it initializes.
let prisma: typeof import('@/lib/prisma').prisma
let createFirstAdmin: typeof import('@/app/(auth)/setup/actions').createFirstAdmin

const TOKEN = 'setup-token-for-tests-123'
const input = (n: number) => ({ name: `Admin ${n}`, email: 'admin@example.com', password: 'correct-horse-battery', token: TOKEN })

describe.skipIf(!available)('createFirstAdmin', () => {
  beforeAll(async () => {
    await prepareTestDatabase('setup')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ createFirstAdmin } = await import('@/app/(auth)/setup/actions'))
  })

  beforeEach(async () => {
    await prepareTestDatabase('setup')
    process.env.ADMIN_EMAIL = 'admin@example.com'
    process.env.SETUP_TOKEN = TOKEN
  })

  afterAll(async () => {
    delete process.env.ADMIN_EMAIL
    delete process.env.SETUP_TOKEN
    await prisma.$disconnect()
  })

  it('creates a single administrator when concurrent requests race', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => createFirstAdmin(input(n))))
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && /déjà configurée/.test(r.error))).toBe(true)
    expect(await prisma.user.count()).toBe(1)
    expect((await prisma.user.findFirst())?.role).toBe('admin')
  })

  it('refuses a second setup once the instance has a user', async () => {
    expect((await createFirstAdmin(input(1))).ok).toBe(true)
    expect(await createFirstAdmin({ ...input(2), email: 'admin@example.com' })).toEqual({
      ok: false,
      error: 'Cette instance est déjà configurée.',
    })
  })

  it('only accepts ADMIN_EMAIL', async () => {
    const result = await createFirstAdmin({ ...input(1), email: 'attacker@example.com' })
    expect(result.ok).toBe(false)
    expect(await prisma.user.count()).toBe(0)
  })

  it('requires SETUP_TOKEN', async () => {
    expect((await createFirstAdmin({ ...input(1), token: undefined })).ok).toBe(false)
    expect((await createFirstAdmin({ ...input(1), token: 'wrong-token' })).ok).toBe(false)
    expect(await prisma.user.count()).toBe(0)
    expect((await createFirstAdmin(input(1))).ok).toBe(true)
    expect(await prisma.user.count()).toBe(1)
  })

  it('refuses every setup while no SETUP_TOKEN is configured', async () => {
    delete process.env.SETUP_TOKEN
    expect((await createFirstAdmin(input(1))).ok).toBe(false)
    expect(await prisma.user.count()).toBe(0)
  })
})
