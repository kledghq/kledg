/**
 * Better Auth's admin endpoints are closed over HTTP, against PostgreSQL and
 * the real Better Auth handler: they read the administrator role from the
 * signed session cache (up to 60 seconds old) and skip Kledg's user
 * management rules. Accounts are created through POST /api/users, whose
 * wrapper reads the role from the database on every request.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('admin_endpoints')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { cookie: '' }
})

vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: state.cookie }) }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => undefined), isEmailEnabled: async () => false }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let auth: typeof import('@/lib/auth').auth

const ORIGIN = 'http://localhost:3000'
const PASSWORD = 'correct-horse-battery'

async function account(email: string, role: 'admin' | 'user') {
  await auth.api.createUser({ body: { email, password: PASSWORD, name: email.split('@')[0], role } })
  const { headers } = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true })
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const user = await prisma.user.findUniqueOrThrow({ where: { email } })
  return { id: user.id, cookie }
}

function admin(path: string, cookie: string, body: unknown) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/admin/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
      body: JSON.stringify(body),
    }),
  )
}

describe.skipIf(!available)('Better Auth admin endpoints', () => {
  beforeAll(async () => {
    await prepareTestDatabase('admin_endpoints')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('admin_endpoints')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('refuses impersonation, password setting and account creation to an administrator demoted a moment ago', async () => {
    const boss = await account('boss@test.local', 'admin')
    const demoted = await account('former-admin@test.local', 'admin')
    const victim = await account('victim@test.local', 'user')
    expect(boss.id).toBeTruthy()
    // Demoted in the database; the browser still holds a fresh signed session cache.
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'user' } })

    expect((await admin('impersonate-user', demoted.cookie, { userId: victim.id })).status).toBe(403)
    expect((await admin('set-user-password', demoted.cookie, { userId: victim.id, newPassword: 'pwned-password-123' })).status).toBe(403)
    expect((await admin('create-user', demoted.cookie, { email: 'backdoor@test.local', password: 'pwned-password-123', name: 'x', role: 'admin' })).status).toBe(403)
    expect(await prisma.user.count({ where: { email: 'backdoor@test.local' } })).toBe(0)
    expect(await prisma.session.count({ where: { impersonatedBy: { not: null } } })).toBe(0)
  })

  it('closes the endpoints Kledg does not use, even to a current administrator', async () => {
    const boss = await account('boss@test.local', 'admin')
    const victim = await account('victim@test.local', 'user')
    for (const [path, body] of [
      ['impersonate-user', { userId: victim.id }],
      ['set-user-password', { userId: victim.id, newPassword: 'pwned-password-123' }],
      ['revoke-user-sessions', { userId: victim.id }],
      ['list-user-sessions', { userId: victim.id }],
    ] as const) {
      expect((await admin(path, boss.cookie, body)).status, path).toBe(403)
    }
  })

  it('creates accounts through POST /api/users, reading the role from the database', async () => {
    const boss = await account('boss@test.local', 'admin')
    const demoted = await account('former-admin@test.local', 'admin')
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'user' } })
    const route = await import('@/app/api/users/route')
    const create = (cookie: string, email: string) => {
      state.cookie = cookie
      return route.POST(
        new NextRequest(`${ORIGIN}/api/users`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
          body: JSON.stringify({ email, password: 'a-long-password-1' }),
        }),
      )
    }
    expect((await create(demoted.cookie, 'nope@test.local')).status).toBe(403)
    const created = await create(boss.cookie, 'new@test.local')
    expect(created.status).toBe(201)
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'new@test.local' } })).role).toBe('user')
    expect(await prisma.auditLog.count({ where: { action: 'USER_CREATED' } })).toBe(1)
  })
})
