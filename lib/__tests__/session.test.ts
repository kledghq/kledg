/**
 * getCurrentUser with the session cookie cache (lib/auth.ts): the session may
 * come from the signed cache, so it is confirmed against the database on
 * every request (one read by session token): a revoked or expired session,
 * a banned user or a removed administrator role apply at once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/lib/prisma', () => ({ prisma: { session: { findUnique: mocks.findUnique } } }))

import { getCurrentUser } from '../session'

const sessionOf = (role: string | null) => ({
  session: { token: 'tok-1' },
  user: { id: 'u1', email: 'a@example.com', name: 'A', role },
})
const row = (role: string | null, extra: Partial<{ banned: boolean; banExpires: Date | null; expiresAt: Date; userId: string }> = {}) => ({
  userId: extra.userId ?? 'u1',
  expiresAt: extra.expiresAt ?? new Date(Date.now() + 3600_000),
  user: { role, banned: extra.banned ?? false, banExpires: extra.banExpires ?? null },
})

describe('getCurrentUser', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a member whose session row still exists', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('user'))
    mocks.findUnique.mockResolvedValue(row('user'))
    expect(await getCurrentUser()).toEqual({ id: 'u1', email: 'a@example.com', name: 'A', role: 'user' })
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { token: 'tok-1' } }))
  })

  it('retries once when the database was still waking up, never other errors', async () => {
    mocks.getSession
      .mockRejectedValueOnce(new Error('Connection terminated due to connection timeout'))
      .mockResolvedValueOnce(sessionOf('user'))
    mocks.findUnique.mockResolvedValue(row('user'))
    expect((await getCurrentUser())?.id).toBe('u1')
    expect(mocks.getSession).toHaveBeenCalledTimes(2)

    mocks.getSession.mockReset()
    mocks.getSession.mockRejectedValue(new Error('invalid input syntax'))
    await expect(getCurrentUser()).rejects.toThrow('invalid input syntax')
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
  })

  it('refuses a session revoked since it was cached', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('user'))
    mocks.findUnique.mockResolvedValue(null)
    expect(await getCurrentUser()).toBeNull()
  })

  it('refuses an expired session or one of another user', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('user'))
    mocks.findUnique.mockResolvedValue(row('user', { expiresAt: new Date(Date.now() - 1000) }))
    expect(await getCurrentUser()).toBeNull()
    mocks.findUnique.mockResolvedValue(row('user', { userId: 'u2' }))
    expect(await getCurrentUser()).toBeNull()
  })

  it('takes the administrator role from the database', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('admin'))
    mocks.findUnique.mockResolvedValue(row('user'))
    expect((await getCurrentUser())?.role).toBe('user')
    mocks.findUnique.mockResolvedValue(row('admin'))
    expect((await getCurrentUser())?.role).toBe('admin')
  })

  it('refuses a banned user, unless the ban has expired', async () => {
    mocks.getSession.mockResolvedValue(sessionOf('admin'))
    mocks.findUnique.mockResolvedValue(row('admin', { banned: true }))
    expect(await getCurrentUser()).toBeNull()
    mocks.findUnique.mockResolvedValue(row('user', { banned: true, banExpires: new Date(Date.now() - 1000) }))
    expect(await getCurrentUser()).not.toBeNull()
  })

  it('returns null without a session', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect(await getCurrentUser()).toBeNull()
  })
})
