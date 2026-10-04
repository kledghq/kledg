/**
 * Account routes (app/api/account): profile, email change, password,
 * sessions and account deletion. Better Auth, the database, emails and the
 * instance policy are mocked; the tests check authentication, the policy,
 * the email configuration rule, the deletion guards and what reaches
 * Better Auth.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type User = { id: string; email: string; name: string | null; role: string | null }

const state = vi.hoisted(() => ({
  user: null as null | User,
  refused: new Set<string>(),
  emailEnabled: true,
  otherAdmins: 1,
  memberships: [] as Array<{ role: string; organizationId: string; organization: { company: { id: string; name: string; slug: string } } }>,
  coAdmins: [] as Array<{ organizationId: string; role: string }>,
}))

class FakeAPIError extends Error {
  constructor(
    public statusCode: number,
    public body: { code: string; message: string },
  ) {
    super(body.message)
  }
}

const authApi = vi.hoisted(() => ({
  getSession: vi.fn(),
  verifyPassword: vi.fn(),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  deleteUser: vi.fn(),
}))

const db = vi.hoisted(() => {
  const client = {
    user: { update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    member: { findMany: vi.fn() },
    session: { findMany: vi.fn(), deleteMany: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    // The deletion runs under the instance users lock: same client as the transaction.
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(client)),
  }
  return client
})

const mail = vi.hoisted(() => ({ sendEmail: vi.fn(async () => {}) }))

vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => state.user) }))
vi.mock('@/lib/instance/policy', () => ({
  isActionAllowed: vi.fn(async (action: string) => !state.refused.has(action)),
  actionRefusalMessage: vi.fn(() => 'Refusé par la politique de cette instance.'),
  SELF_AUTHENTICATED_API_ROUTES: {},
}))
vi.mock('@/lib/auth', () => ({ auth: { api: authApi } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/email', () => ({ isEmailEnabled: vi.fn(async () => state.emailEnabled), sendEmail: mail.sendEmail }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => {}) }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import * as accountRoute from '../account/route'
import * as profileRoute from '../account/profile/route'
import * as emailRoute from '../account/email/route'
import * as passwordRoute from '../account/password/route'
import * as sessionsRoute from '../account/sessions/route'
import * as sessionRoute from '../account/sessions/[id]/route'

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

const MEMBER: User = { id: 'u-member', email: 'marie@acme.fr', name: 'Marie', role: 'user' }
const ADMIN: User = { id: 'u-admin', email: 'admin@acme.fr', name: 'Admin', role: 'admin' }

function call(handler: Handler, method: string, url: string, body?: unknown, params: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=abc' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handler(request, { params: Promise.resolve(params) })
}

function withCookie(response: unknown) {
  const headers = new Headers()
  headers.append('set-cookie', 'better-auth.session_token=new; Path=/; HttpOnly')
  return { headers, response }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = MEMBER
  state.refused = new Set()
  state.emailEnabled = true
  state.otherAdmins = 1
  state.memberships = []
  state.coAdmins = []
  authApi.getSession.mockResolvedValue({ session: { id: 's-current' }, user: { id: MEMBER.id } })
  authApi.verifyPassword.mockResolvedValue({ status: true })
  authApi.changeEmail.mockResolvedValue({ status: true })
  authApi.changePassword.mockResolvedValue(withCookie({ token: null }))
  authApi.deleteUser.mockResolvedValue(withCookie({ success: true }))
  db.user.update.mockImplementation(async ({ data }: { data: { name?: string } }) => ({ id: state.user!.id, name: data.name, email: state.user!.email }))
  db.user.findFirst.mockResolvedValue(null)
  db.user.count.mockImplementation(async () => state.otherAdmins)
  db.member.findMany.mockImplementation(async (args: { where: { organizationId?: { in: string[] } } }) =>
    args.where.organizationId ? state.coAdmins.filter((m) => args.where.organizationId!.in.includes(m.organizationId)) : state.memberships,
  )
  db.session.deleteMany.mockResolvedValue({ count: 1 })
})

describe('signed out', () => {
  const routes: Array<[string, Handler, string, string, unknown?]> = [
    ['update profile', profileRoute.PATCH, 'PATCH', '/api/account/profile', { name: 'X' }],
    ['change email', emailRoute.POST, 'POST', '/api/account/email', { newEmail: 'a@b.fr', password: 'x' }],
    ['change password', passwordRoute.POST, 'POST', '/api/account/password', { currentPassword: 'x', newPassword: 'y'.repeat(10) }],
    ['list sessions', sessionsRoute.GET, 'GET', '/api/account/sessions'],
    ['revoke other sessions', sessionsRoute.DELETE, 'DELETE', '/api/account/sessions'],
    ['revoke a session', sessionRoute.DELETE, 'DELETE', '/api/account/sessions/s-2'],
    ['delete account', accountRoute.DELETE, 'DELETE', '/api/account', { email: 'a@b.fr', password: 'x' }],
  ]

  it.each(routes)('%s answers 401', async (_name, handler, method, url, body) => {
    state.user = null
    const response = await call(handler, method, url, body, { id: 's-2' })
    expect(response.status).toBe(401)
    expect(authApi.changeEmail).not.toHaveBeenCalled()
    expect(authApi.changePassword).not.toHaveBeenCalled()
    expect(authApi.deleteUser).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
    expect(db.session.deleteMany).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/account/profile', () => {
  it("updates the signed-in user's name, trimmed", async () => {
    const response = await call(profileRoute.PATCH, 'PATCH', '/api/account/profile', { name: '  Marie Dupont ' })
    expect(response.status).toBe(200)
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: MEMBER.id }, data: { name: 'Marie Dupont' } }))
    expect((await response.json()).name).toBe('Marie Dupont')
  })

  it('refuses an empty name', async () => {
    const response = await call(profileRoute.PATCH, 'PATCH', '/api/account/profile', { name: '   ' })
    expect(response.status).toBe(400)
    expect(db.user.update).not.toHaveBeenCalled()
  })
})

describe('POST /api/account/email', () => {
  const body = { newEmail: 'Marie.Nouvelle@Acme.fr', password: 'secret-password' }

  it('checks the password, asks Better Auth to send the link to the new address and notifies the current one', async () => {
    const response = await call(emailRoute.POST, 'POST', '/api/account/email', body)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'verification-sent' })
    expect(authApi.verifyPassword).toHaveBeenCalledWith(expect.objectContaining({ body: { password: 'secret-password' } }))
    expect(authApi.changeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ body: { newEmail: 'marie.nouvelle@acme.fr', callbackURL: '/settings/profile?email=confirmed' } }),
    )
    expect(mail.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: MEMBER.email }))
    // The address itself never changes here: only the confirmation link does it.
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('refuses a wrong password before anything is sent', async () => {
    authApi.verifyPassword.mockRejectedValue(new FakeAPIError(400, { code: 'INVALID_PASSWORD', message: 'Invalid password' }))
    const response = await call(emailRoute.POST, 'POST', '/api/account/email', body)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/Mot de passe incorrect/)
    expect(authApi.changeEmail).not.toHaveBeenCalled()
    expect(mail.sendEmail).not.toHaveBeenCalled()
  })

  it('refuses the current address', async () => {
    const response = await call(emailRoute.POST, 'POST', '/api/account/email', { ...body, newEmail: 'MARIE@acme.fr' })
    expect(response.status).toBe(400)
    expect(authApi.changeEmail).not.toHaveBeenCalled()
  })

  it('without email configuration, refuses a regular user and points to the administrator', async () => {
    state.emailEnabled = false
    const response = await call(emailRoute.POST, 'POST', '/api/account/email', body)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/administrateur de l'instance/)
    expect(authApi.verifyPassword).not.toHaveBeenCalled()
    expect(authApi.changeEmail).not.toHaveBeenCalled()
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('without email configuration, lets an instance administrator change their own address after the password', async () => {
    state.emailEnabled = false
    state.user = ADMIN
    const response = await call(emailRoute.POST, 'POST', '/api/account/email', body)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'updated', email: 'marie.nouvelle@acme.fr' })
    expect(authApi.verifyPassword).toHaveBeenCalled()
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: ADMIN.id },
      data: { email: 'marie.nouvelle@acme.fr', emailVerified: false },
    })
  })

  it("does not let an administrator take another account's address", async () => {
    state.emailEnabled = false
    state.user = ADMIN
    db.user.findFirst.mockResolvedValue({ id: 'u-other' })
    const response = await call(emailRoute.POST, 'POST', '/api/account/email', body)
    expect(response.status).toBe(409)
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('answers 403 with the policy message when the instance refuses email changes', async () => {
    state.refused.add('change-email')
    const response = await call(emailRoute.POST, 'POST', '/api/account/email', body)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('Refusé par la politique de cette instance.')
    expect(authApi.changeEmail).not.toHaveBeenCalled()
  })
})

describe('POST /api/account/password', () => {
  const body = { currentPassword: 'old-password', newPassword: 'new-password-123', revokeOtherSessions: true }

  it('changes the password through Better Auth and forwards the new session cookie', async () => {
    const response = await call(passwordRoute.POST, 'POST', '/api/account/password', body)
    expect(response.status).toBe(200)
    expect(authApi.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ body: { currentPassword: 'old-password', newPassword: 'new-password-123', revokeOtherSessions: true } }),
    )
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=new')
  })

  it('keeps the 10 character minimum', async () => {
    const response = await call(passwordRoute.POST, 'POST', '/api/account/password', { ...body, newPassword: 'short' })
    expect(response.status).toBe(400)
    expect(authApi.changePassword).not.toHaveBeenCalled()
  })

  it('translates a wrong current password', async () => {
    authApi.changePassword.mockRejectedValue(new FakeAPIError(400, { code: 'INVALID_PASSWORD', message: 'Invalid password' }))
    const response = await call(passwordRoute.POST, 'POST', '/api/account/password', body)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/Mot de passe incorrect/)
  })

  it('answers 403 with the policy message when the instance refuses password changes', async () => {
    state.refused.add('change-password')
    const response = await call(passwordRoute.POST, 'POST', '/api/account/password', body)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('Refusé par la politique de cette instance.')
    expect(authApi.changePassword).not.toHaveBeenCalled()
  })
})

describe('sessions', () => {
  it('lists active sessions without their tokens, the current one first', async () => {
    const date = new Date('2026-10-03T08:00:00Z')
    db.session.findMany.mockResolvedValue([
      { id: 's-other', userAgent: 'curl/8.7.1', ipAddress: '203.0.113.9', createdAt: date, updatedAt: date },
      { id: 's-current', userAgent: null, ipAddress: null, createdAt: date, updatedAt: date },
    ])
    const response = await call(sessionsRoute.GET, 'GET', '/api/account/sessions')
    expect(response.status).toBe(200)
    const sessions = await response.json()
    expect(sessions.map((s: { id: string; current: boolean }) => [s.id, s.current])).toEqual([
      ['s-current', true],
      ['s-other', false],
    ])
    expect(JSON.stringify(sessions)).not.toContain('token')
    expect(db.session.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: MEMBER.id }) }))
  })

  it("revokes one session of the user only (another user's session is a 404)", async () => {
    const ok = await call(sessionRoute.DELETE, 'DELETE', '/api/account/sessions/s-other', undefined, { id: 's-other' })
    expect(ok.status).toBe(204)
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { id: 's-other', userId: MEMBER.id } })

    db.session.deleteMany.mockResolvedValue({ count: 0 })
    const missing = await call(sessionRoute.DELETE, 'DELETE', '/api/account/sessions/s-foreign', undefined, { id: 's-foreign' })
    expect(missing.status).toBe(404)
  })

  it('does not revoke the current session (that is signing out)', async () => {
    const response = await call(sessionRoute.DELETE, 'DELETE', '/api/account/sessions/s-current', undefined, { id: 's-current' })
    expect(response.status).toBe(400)
    expect(db.session.deleteMany).not.toHaveBeenCalled()
  })

  it('revokes every other session and keeps the current one', async () => {
    db.session.deleteMany.mockResolvedValue({ count: 3 })
    const response = await call(sessionsRoute.DELETE, 'DELETE', '/api/account/sessions')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ revoked: 3 })
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: MEMBER.id, id: { not: 's-current' } } })
  })
})

describe('DELETE /api/account', () => {
  const body = { email: 'Marie@Acme.fr', password: 'secret-password' }
  const acme = { id: 'c-acme', name: 'Acme', slug: 'acme' }

  it('deletes the account through Better Auth with the password and clears the cookie', async () => {
    state.memberships = [{ role: 'accountant', organizationId: 'org-acme', organization: { company: acme } }]
    const response = await call(accountRoute.DELETE, 'DELETE', '/api/account', body)
    expect(response.status).toBe(200)
    expect(authApi.deleteUser).toHaveBeenCalledWith(expect.objectContaining({ body: { password: 'secret-password' }, returnHeaders: true }))
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token')
  })

  it('requires the typed email to match the account', async () => {
    const response = await call(accountRoute.DELETE, 'DELETE', '/api/account', { ...body, email: 'autre@acme.fr' })
    expect(response.status).toBe(400)
    expect(authApi.deleteUser).not.toHaveBeenCalled()
  })

  it('refuses the last administrator of the instance', async () => {
    state.user = ADMIN
    state.otherAdmins = 0
    const response = await call(accountRoute.DELETE, 'DELETE', '/api/account', { ...body, email: ADMIN.email })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/seul administrateur de l'instance/)
    expect(authApi.deleteUser).not.toHaveBeenCalled()
  })

  it('refuses the last company administrator of a company', async () => {
    state.memberships = [{ role: 'companyAdmin', organizationId: 'org-acme', organization: { company: acme } }]
    const response = await call(accountRoute.DELETE, 'DELETE', '/api/account', body)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/seul administrateur de la société Acme/)
    expect(authApi.deleteUser).not.toHaveBeenCalled()
  })

  it('lets a company administrator go when the company keeps another one', async () => {
    state.memberships = [{ role: 'companyAdmin', organizationId: 'org-acme', organization: { company: acme } }]
    state.coAdmins = [{ organizationId: 'org-acme', role: 'companyAdmin' }]
    const response = await call(accountRoute.DELETE, 'DELETE', '/api/account', body)
    expect(response.status).toBe(200)
    expect(authApi.deleteUser).toHaveBeenCalled()
  })

  it('answers 403 with the policy message when the instance refuses account deletion', async () => {
    state.refused.add('delete-account')
    const response = await call(accountRoute.DELETE, 'DELETE', '/api/account', body)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('Refusé par la politique de cette instance.')
    expect(authApi.deleteUser).not.toHaveBeenCalled()
  })

  it('translates a wrong password', async () => {
    authApi.deleteUser.mockRejectedValue(new FakeAPIError(400, { code: 'INVALID_PASSWORD', message: 'Invalid password' }))
    const response = await call(accountRoute.DELETE, 'DELETE', '/api/account', body)
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/Mot de passe incorrect/)
  })
})
