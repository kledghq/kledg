/**
 * requireUser and the session token check of getCurrentUser (lib/session.ts),
 * with Better Auth and Prisma mocked. The session cache rules are in
 * session.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), findUnique: vi.fn() }))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/lib/prisma', () => ({ prisma: { session: { findUnique: mocks.findUnique } } }))

import { getCurrentUser, requireUser, UnauthorizedError } from '@/lib/session'

const future = () => new Date(Date.now() + 3_600_000)

beforeEach(() => vi.clearAllMocks())

describe('getCurrentUser', () => {
  it('refuses a session without a token, without reading the database', async () => {
    mocks.getSession.mockResolvedValue({ session: {}, user: { id: 'u1', email: 'a@example.com' } })
    expect(await getCurrentUser()).toBeNull()
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('returns a null name and role when the user has none', async () => {
    mocks.getSession.mockResolvedValue({ session: { token: 'tok-1' }, user: { id: 'u1', email: 'a@example.com' } })
    mocks.findUnique.mockResolvedValue({ userId: 'u1', expiresAt: future(), user: { role: null, banned: null, banExpires: null } })
    expect(await getCurrentUser()).toEqual({ id: 'u1', email: 'a@example.com', name: null, role: null })
  })
})

describe('requireUser', () => {
  it('returns the signed-in user', async () => {
    mocks.getSession.mockResolvedValue({ session: { token: 'tok-1' }, user: { id: 'u1', email: 'a@example.com', name: 'A' } })
    mocks.findUnique.mockResolvedValue({ userId: 'u1', expiresAt: future(), user: { role: 'user', banned: false, banExpires: null } })
    expect(await requireUser()).toEqual({ id: 'u1', email: 'a@example.com', name: 'A', role: 'user' })
  })

  it('throws UnauthorizedError without a session', async () => {
    mocks.getSession.mockResolvedValue(null)
    const error = await requireUser().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UnauthorizedError)
    expect(error).toMatchObject({ name: 'UnauthorizedError', message: 'Unauthorized' })
  })

  it('throws UnauthorizedError for a banned user whose ban has not expired', async () => {
    mocks.getSession.mockResolvedValue({ session: { token: 'tok-1' }, user: { id: 'u1', email: 'a@example.com' } })
    mocks.findUnique.mockResolvedValue({ userId: 'u1', expiresAt: future(), user: { role: 'user', banned: true, banExpires: future() } })
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError)
  })
})
