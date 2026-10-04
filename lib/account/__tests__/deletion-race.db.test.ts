/**
 * Account deletion race, against PostgreSQL and the real Better Auth
 * (lib/__tests__/helpers/test-db.ts): the last two administrators of an
 * instance deleting their accounts at the same moment. Without the instance
 * users lock both checks see the other administrator and both deletions go
 * through, leaving the instance without any administrator.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('deletion_race')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Auth = typeof import('@/lib/auth').auth
let prisma: typeof import('@/lib/prisma').prisma
let auth: Auth
let deleteAccount: typeof import('@/lib/account/delete-account.service').deleteAccount

const PASSWORD = 'correct-horse-battery'

/** Creates an account with a password and returns the user and the headers of a signed-in browser. */
async function signedIn(email: string, role: 'admin' | 'user') {
  await auth.api.createUser({ body: { email, password: PASSWORD, name: email.split('@')[0], role } })
  const { headers } = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true })
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, email: true, name: true, role: true } })
  return { user, headers: new Headers({ cookie }) }
}

describe.skipIf(!available)('account deletion race', () => {
  beforeAll(async () => {
    await prepareTestDatabase('deletion_race')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
    ;({ deleteAccount } = await import('@/lib/account/delete-account.service'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('deletion_race')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('keeps one administrator when the last two delete their accounts at once', async () => {
    const a = await signedIn('admin-a@test.local', 'admin')
    const b = await signedIn('admin-b@test.local', 'admin')

    const results = await Promise.allSettled([
      deleteAccount(a.user, a.headers, { email: a.user.email, password: PASSWORD }),
      deleteAccount(b.user, b.headers, { email: b.user.email, password: PASSWORD }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(refused).toHaveLength(1)
    expect(String(refused[0].reason?.message)).toMatch(/seul administrateur de l'instance/)
    expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(1)
  })

  it('lets an administrator go when another active one remains, and refuses the last one', async () => {
    const a = await signedIn('admin-a@test.local', 'admin')
    const b = await signedIn('admin-b@test.local', 'admin')

    await deleteAccount(a.user, a.headers, { email: a.user.email, password: PASSWORD })
    await expect(deleteAccount(b.user, b.headers, { email: b.user.email, password: PASSWORD })).rejects.toThrow(
      /seul administrateur de l'instance/,
    )
    expect(await prisma.user.findMany({ select: { email: true } })).toEqual([{ email: 'admin-b@test.local' }])
  })

  it('does not count a banned administrator as the one who remains', async () => {
    const a = await signedIn('admin-a@test.local', 'admin')
    await signedIn('admin-b@test.local', 'admin')
    await prisma.user.update({ where: { email: 'admin-b@test.local' }, data: { banned: true } })

    await expect(deleteAccount(a.user, a.headers, { email: a.user.email, password: PASSWORD })).rejects.toThrow(
      /seul administrateur de l'instance/,
    )
    expect(await prisma.user.count()).toBe(2)
  })
})
