/**
 * Credential changes end the other sessions, against PostgreSQL and the real
 * Better Auth endpoints (HTTP handler, in process):
 * - a password reset revokes every session of the account (a stolen session
 *   must not survive the reset meant to evict it);
 * - a password change revokes the other sessions unless the user explicitly
 *   keeps them;
 * - a revoked session is refused by getCurrentUser at once, even while the
 *   browser still holds a fresh signed session cache cookie (lib/auth.ts,
 *   SESSION_COOKIE_CACHE_SECONDS).
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('session_revocation')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { mails: [] as Array<{ to: string; text?: string; html?: string }>, cookie: '' }
})

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (message: { to: string; text?: string; html?: string }) => {
    state.mails.push(message)
  }),
  isEmailEnabled: async () => true,
}))
// getCurrentUser reads the request headers: the cookie of the browser under test.
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: state.cookie }) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let auth: typeof import('@/lib/auth').auth

const ORIGIN = 'http://localhost:3000'
const EMAIL = 'marie@test.local'
const PASSWORD = 'correct-horse-battery'

function cookieOf(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

async function signIn(password = PASSWORD): Promise<string> {
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL, password }),
    }),
  )
  expect(response.status).toBe(200)
  return cookieOf(response.headers)
}

async function sessions(): Promise<number> {
  return prisma.session.count({ where: { user: { email: EMAIL } } })
}

describe.skipIf(!available)('session revocation on credential changes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('session_revocation')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('session_revocation')
    state.mails = []
    await auth.api.createUser({ body: { email: EMAIL, password: PASSWORD, name: 'Marie', role: 'user' } })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('revokes every session of the account on a password reset', async () => {
    await signIn()
    await signIn() // the attacker's stolen session
    expect(await sessions()).toBe(2)

    const requested = await auth.handler(
      new Request(`${ORIGIN}/api/auth/request-password-reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: EMAIL, redirectTo: '/reset-password' }),
      }),
    )
    expect(requested.status).toBe(200)
    const mail = state.mails.at(-1)
    const token = /reset-password\/([A-Za-z0-9_-]+)/.exec(`${mail?.text ?? ''} ${mail?.html ?? ''}`)?.[1]
    expect(token).toBeTruthy()

    const reset = await auth.handler(
      new Request(`${ORIGIN}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ newPassword: 'another-long-password', token }),
      }),
    )
    expect(reset.status).toBe(200)
    expect(await sessions()).toBe(0)
  })

  it('revokes the other sessions on a password change by default', async () => {
    const stolen = await signIn()
    const mine = await signIn()
    state.cookie = mine
    const route = await import('@/app/api/account/password/route')
    const response = await route.POST(
      new NextRequest(`${ORIGIN}/api/account/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: mine },
        body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'another-long-password' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await sessions()).toBe(1)
    const stolenToken = decodeURIComponent(/better-auth\.session_token=([^;]+)/.exec(stolen)?.[1] ?? '').split('.')[0]
    expect(await prisma.session.count({ where: { token: stolenToken } })).toBe(0)
  })

  it('refuses a revoked session at once, even with a fresh session cache cookie', async () => {
    const { getCurrentUser } = await import('@/lib/session')
    state.cookie = await signIn()
    expect(state.cookie).toContain('session_data')
    // Revoked elsewhere (sign out on another device, reset, ban): the row is gone.
    await prisma.session.deleteMany({ where: { user: { email: EMAIL } } })
    expect(await getCurrentUser()).toBeNull()
  })
})
