/**
 * Instance user management (lib/users, app/api/users/[id]) against
 * PostgreSQL and the real Better Auth admin plugin, with only the session
 * of the route wrapper and the instance policy mocked:
 * - list: role, status, creation and last session, never a secret;
 * - role, ban, email change (administrator password), deletion;
 * - the instance always keeps an administrator, even when two
 *   administrators demote each other at the same moment;
 * - the deletion guards of a self-deletion; the "manage-users" policy.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('instance_users')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  const { AsyncLocalStorage } = await import('node:async_hooks')
  return {
    // Per request, so concurrent calls of two administrators keep their own session.
    session: new AsyncLocalStorage<{ id: string; email: string; name: string | null; role: string | null }>(),
    refused: new Set<string>(),
  }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.session.getStore() ?? null }))
vi.mock('@/lib/instance/policy', () => ({
  isActionAllowed: async (action: string) => !state.refused.has(action),
  actionRefusalMessage: () => 'Refusé par la politique de cette instance.',
  SELF_AUTHENTICATED_API_ROUTES: {},
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
let auth: typeof import('@/lib/auth').auth
let route: Record<'PATCH' | 'DELETE', Handler>
let service: typeof import('@/lib/users/instance-users.service')

const PASSWORD = 'correct-horse-battery'
const ORIGIN = 'http://localhost:3000'

interface Account {
  user: { id: string; email: string; name: string | null; role: string | null }
  cookie: string
}

async function account(email: string, role: 'admin' | 'user'): Promise<Account> {
  await auth.api.createUser({ body: { email, password: PASSWORD, name: email.split('@')[0], role } })
  const { headers } = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true })
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, email: true, name: true, role: true } })
  return { user, cookie }
}

function call(as: Account, method: 'PATCH' | 'DELETE', targetId: string, body?: unknown, headers: Record<string, string> = {}) {
  const request = new NextRequest(`${ORIGIN}/api/users/${targetId}`, {
    method,
    headers: { cookie: as.cookie, origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return state.session.run(as.user, () => route[method](request, { params: Promise.resolve({ id: targetId }) }))
}

const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

describe.skipIf(!available)('instance user management', () => {
  let admin: Account
  let other: Account
  let member: Account

  beforeAll(async () => {
    await prepareTestDatabase('instance_users')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
    route = (await import('@/app/api/users/[id]/route')) as unknown as Record<'PATCH' | 'DELETE', Handler>
    service = await import('@/lib/users/instance-users.service')
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('instance_users')
    state.refused = new Set()
    admin = await account('admin@test.local', 'admin')
    other = await account('other-admin@test.local', 'admin')
    member = await account('marie@test.local', 'user')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('lists the accounts with role, status and last session, without any secret', async () => {
    const users = await service.listInstanceUsers()
    expect(users.map((u) => [u.email, u.role, u.banned])).toEqual([
      ['admin@test.local', 'admin', false],
      ['marie@test.local', 'user', false],
      ['other-admin@test.local', 'admin', false],
    ])
    expect(users.every((u) => u.lastSessionAt !== null)).toBe(true)
    expect(Object.keys(users[0]).sort()).toEqual(['createdAt', 'email', 'emailVerified', 'id', 'lastSessionAt', 'name', 'role', 'banned'].sort())
    expect(await service.listInstanceUsers({ search: 'MARIE' })).toHaveLength(1)
  })

  it('names an administrator and takes the role back', async () => {
    expect((await call(admin, 'PATCH', member.user.id, { action: 'set-role', role: 'admin' })).status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } })).role).toBe('admin')
    expect((await call(admin, 'PATCH', member.user.id, { action: 'set-role', role: 'user' })).status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } })).role).toBe('user')
    expect(await prisma.auditLog.count({ where: { action: 'USER_ROLE_CHANGED' } })).toBe(2)
  })

  it('never lets an administrator change their own role, block or delete themselves here', async () => {
    const own = [
      await call(admin, 'PATCH', admin.user.id, { action: 'set-role', role: 'user' }),
      await call(admin, 'PATCH', admin.user.id, { action: 'ban' }),
      await call(admin, 'DELETE', admin.user.id),
    ]
    expect(own.map((r) => r.status)).toEqual([400, 400, 400])
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).role).toBe('admin')
  })

  it('keeps one administrator when two administrators demote each other at once', async () => {
    const [first, second] = await Promise.all([
      call(admin, 'PATCH', other.user.id, { action: 'set-role', role: 'user' }),
      call(other, 'PATCH', admin.user.id, { action: 'set-role', role: 'user' }),
    ])
    expect([first.status, second.status].sort()).toEqual([200, 403])
    expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(1)
  })

  it('keeps one administrator when two administrators block each other at once', async () => {
    await Promise.all([call(admin, 'PATCH', other.user.id, { action: 'ban' }), call(other, 'PATCH', admin.user.id, { action: 'ban' })])
    expect(await prisma.user.count({ where: { role: 'admin', OR: [{ banned: null }, { banned: false }] } })).toBe(1)
  })

  it('blocks an account, closes its sessions, and unblocks it', async () => {
    expect(await prisma.session.count({ where: { userId: member.user.id } })).toBe(1)
    expect((await call(admin, 'PATCH', member.user.id, { action: 'ban' })).status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } })).banned).toBe(true)
    expect(await prisma.session.count({ where: { userId: member.user.id } })).toBe(0)
    expect((await call(admin, 'PATCH', member.user.id, { action: 'unban' })).status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } })).banned).toBe(false)
  })

  it("changes another account's email after the administrator's password", async () => {
    const wrong = await call(admin, 'PATCH', member.user.id, { action: 'change-email', email: 'marie@new.test', password: 'not-my-password' })
    expect(wrong.status).toBe(400)
    expect(await errorOf(wrong)).toMatch(/Mot de passe incorrect/)

    const taken = await call(admin, 'PATCH', member.user.id, { action: 'change-email', email: 'Other-Admin@test.local', password: PASSWORD })
    expect(taken.status).toBe(409)

    const ok = await call(admin, 'PATCH', member.user.id, { action: 'change-email', email: 'Marie@New.test', password: PASSWORD })
    expect(ok.status).toBe(200)
    expect(await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } })).toMatchObject({ email: 'marie@new.test', emailVerified: false })
  })

  it('deletes an account with its API keys, and refuses the last administrator of a company', async () => {
    const company = await prisma.company.create({ data: { name: 'Atelier Alpha', slug: 'atelier-alpha', siren: '111111111' } })
    await prisma.organization.create({ data: { id: company.id, name: company.name, slug: 'org-alpha', createdAt: new Date(), companyId: company.id } })
    await prisma.member.create({ data: { id: 'm-marie', userId: member.user.id, organizationId: company.id, role: 'companyAdmin', createdAt: new Date() } })
    const now = new Date()
    await prisma.apikey.create({ data: { id: 'key-marie', referenceId: member.user.id, key: 'hashed', createdAt: now, updatedAt: now } })

    const refused = await call(admin, 'DELETE', member.user.id)
    expect(refused.status).toBe(409)
    expect(await errorOf(refused)).toMatch(/Ce compte est le seul administrateur de la société Atelier Alpha/)

    await prisma.member.update({ where: { id: 'm-marie' }, data: { role: 'accountant' } })
    expect((await call(admin, 'DELETE', member.user.id)).status).toBe(204)
    expect(await prisma.user.findUnique({ where: { id: member.user.id } })).toBeNull()
    expect(await prisma.apikey.count({ where: { referenceId: member.user.id } })).toBe(0)
    // The company and its books stay
    expect(await prisma.company.count({ where: { id: company.id } })).toBe(1)
  })

  it('answers 403 to regular users and refuses requests from another site', async () => {
    expect((await call(member, 'PATCH', other.user.id, { action: 'ban' })).status).toBe(403)
    expect((await call(admin, 'DELETE', member.user.id, undefined, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect(await prisma.user.count()).toBe(3)
  })

  it('follows the instance policy ("manage-users")', async () => {
    state.refused.add('manage-users')
    const response = await call(admin, 'PATCH', member.user.id, { action: 'set-role', role: 'admin' })
    expect(response.status).toBe(403)
    expect(await errorOf(response)).toBe('Refusé par la politique de cette instance.')
    expect(await service.manageUsersState({ ...admin.user })).toEqual({ allowed: false, message: 'Refusé par la politique de cette instance.' })
  })

  it('closes the Better Auth admin endpoints that would skip these checks', async () => {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/admin/remove-user`, {
        method: 'POST',
        headers: { cookie: admin.cookie, origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: other.user.id }),
      }),
    )
    expect(response.status).toBe(403)
    expect(await prisma.user.count({ where: { id: other.user.id } })).toBe(1)
  })
})
