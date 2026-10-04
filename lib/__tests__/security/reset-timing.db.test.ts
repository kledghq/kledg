/**
 * KLEDG-SEC-009: a password-reset request must not reveal, through its
 * response time, whether the address has an account. Better Auth awaits the
 * reset hook only for an existing account, so the hook (lib/auth.ts) hands
 * the delivery to waitUntil instead of awaiting it.
 *
 * Here the email delivery never finishes until the test releases it: the
 * request for a known address must still answer, with the same body as for
 * an unknown one, while the delivery is pending. Then the delivery goes on.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('reset_timing')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { started: [] as string[], delivered: [] as string[], release: () => {} }
})

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn((message: { to: string }) => {
    state.started.push(message.to)
    return new Promise<void>((resolve) => {
      state.release = () => {
        state.delivered.push(message.to)
        resolve()
      }
    })
  }),
  isEmailEnabled: async () => true,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let auth: typeof import('@/lib/auth').auth

const ORIGIN = 'http://localhost:3000'
const KNOWN = 'known@test.local'

function requestReset(email: string): Promise<Response> {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, redirectTo: '/reset-password' }),
    }),
  )
}

/** The response, or "pending" if it has not come within `ms`. */
async function within(response: Promise<Response>, ms: number): Promise<Response | 'pending'> {
  return Promise.race([response, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms))])
}

describe.skipIf(!available)('password-reset request timing (KLEDG-SEC-009)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('reset_timing')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
    await auth.api.createUser({ body: { email: KNOWN, password: 'correct-horse-battery', name: 'Known', role: 'user' } })
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('answers a known address without waiting for the email, with the same body as an unknown one', async () => {
    const known = await within(requestReset(KNOWN), 5_000)
    expect(known, 'the response waited for the email delivery').not.toBe('pending')
    expect(state.started).toEqual([KNOWN])
    expect(state.delivered).toEqual([])

    const unknown = await requestReset('nobody@test.local')
    expect((known as Response).status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(await (known as Response).json()).toEqual(await unknown.json())

    // The delivery is not dropped: it completes after the response.
    state.release()
    await vi.waitFor(() => expect(state.delivered).toEqual([KNOWN]))
  })
})
