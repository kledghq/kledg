/**
 * Company invitations (GitHub issue #13) against PostgreSQL and the real
 * Better Auth instance, through the route handlers (only the session and the
 * mail delivery mocked) and the acceptance service of the invitation page:
 * - a company administrator invites by email with a company role; an
 *   accountant (no members:manage) cannot; a role above the inviter's own is
 *   refused; the instance administrator role is never accepted;
 * - the emailed link carries a token whose SHA-256 only is stored; the link
 *   is returned to the inviter only when no email can carry it;
 * - one open invitation per address; a member cannot be invited again;
 * - acceptance creates the account (address confirmed) or links the
 *   signed-in invited account, gives the invited role, and is single use;
 *   another account, an expired, revoked or resent (old link) invitation is
 *   refused;
 * - the instance policy can refuse invitations ('invite-member', also at
 *   acceptance) and accounts created from a link ('invitation-sign-up');
 * - a read-only company neither invites nor accepts;
 * - revoke and resend, audit entries, list without tokens;
 * - another company's invitation is unreachable (404).
 * Runs under KLEDG_RLS=enforce too. Skipped when the test database server is
 * unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('company_invitations')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return {
    user: null as null | { id: string; email: string; name: string | null; role: string | null },
    emailEnabled: true,
    mails: [] as Array<{ to: string; subject: string; text: string; html: string }>,
    refused: new Set<string>(),
    readOnly: new Set<string>(),
  }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (message: { to: string; subject: string; text: string; html: string }) => {
    state.mails.push(message)
  }),
  isEmailEnabled: async () => state.emailEnabled,
}))
vi.mock('@/lib/instance/policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instance/policy')>()),
  isActionAllowed: async (action: string) => !state.refused.has(action),
  companyWriteRefusal: async (companyId: string) => (state.readOnly.has(companyId) ? { message: 'Société en lecture seule.' } : null),
}))

import { createHash } from 'crypto'
import { rolesGrant } from '@/lib/rbac/authorize'
import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
let auth: typeof import('@/lib/auth').auth
let service: typeof import('@/lib/rbac/company-invitations.service')
let routes: { list: Record<string, Handler>; one: Record<string, Handler>; resend: Record<string, Handler> }

const USERS = {
  admin: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' },
  companyAdmin: { id: 'u-cadmin', email: 'cadmin@test.local', name: 'Claire Admin', role: 'user' },
  accountant: { id: 'u-accountant', email: 'accountant@test.local', name: 'Compta', role: 'user' },
  outsider: { id: 'u-outsider', email: 'outsider@test.local', name: 'Other', role: 'user' },
} as const
const ids = {} as Record<string, string>

async function call(who: keyof typeof USERS, method: string, route: keyof typeof routes, params: Record<string, string>, body?: unknown) {
  state.user = { ...USERS[who] }
  const path = `/api/companies/${params.id}/invitations${params.invitationId ? `/${params.invitationId}` : ''}${route === 'resend' ? '/resend' : ''}`
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
  return routes[route][method](request, { params: Promise.resolve(params) })
}

const invite = (who: keyof typeof USERS, email: string, role: string, companyId = ids.a) =>
  call(who, 'POST', 'list', { id: companyId }, { email, role })

/** The token of the last email sent to `to`. */
function tokenSentTo(to: string): string {
  const mail = [...state.mails].reverse().find((m) => m.to === to)
  const match = mail?.text.match(/\/invitation\/([A-Za-z0-9_-]{43})/)
  if (!match) throw new Error(`no invitation sent to ${to}`)
  return match[1]
}

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { ...user, emailVerified: true } })
  }
  for (const [key, name, slug, siren] of [['a', 'Atelier Alpha', 'atelier-alpha', '111111111'], ['b', 'Bureau Beta', 'bureau-beta', '222222222']]) {
    const company = await prisma.company.create({ data: { name, slug, siren } })
    await prisma.organization.create({ data: { id: `org-${key}`, name, slug, companyId: company.id, createdAt: new Date() } })
    ids[key] = company.id
  }
  for (const [userId, organizationId, role] of [['u-cadmin', 'org-a', 'companyAdmin'], ['u-accountant', 'org-a', 'accountant'], ['u-outsider', 'org-b', 'companyAdmin']]) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }
}

describe.skipIf(!available)('company invitations (issue #13)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('company_invitations')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
    service = await import('@/lib/rbac/company-invitations.service')
    routes = {
      list: (await import('@/app/api/companies/[id]/invitations/route')) as unknown as Record<string, Handler>,
      one: (await import('@/app/api/companies/[id]/invitations/[invitationId]/route')) as unknown as Record<string, Handler>,
      resend: (await import('@/app/api/companies/[id]/invitations/[invitationId]/resend/route')) as unknown as Record<string, Handler>,
    }
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('company_invitations')
    state.emailEnabled = true
    state.mails.length = 0
    state.refused.clear()
    state.readOnly.clear()
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('lets a company administrator invite by email; the link is emailed and only its hash is stored', async () => {
    const response = await invite('companyAdmin', '  Expert@Cabinet.FR ', 'accountant')
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({ emailSent: true, invitation: { email: 'expert@cabinet.fr', role: 'accountant', expired: false, invitedBy: { name: 'Claire Admin' } } })
    expect(body.link).toBeUndefined()
    expect(JSON.stringify(body)).not.toMatch(/tokenHash|\/invitation\//)

    expect(state.mails).toHaveLength(1)
    expect(state.mails[0].subject).toBe('Invitation à rejoindre Atelier Alpha sur Kledg')
    const token = tokenSentTo('expert@cabinet.fr')
    const row = await prisma.companyInvitation.findFirstOrThrow({ where: { companyId: ids.a } })
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(JSON.stringify(row)).not.toContain(token)
    // Valid 7 days
    expect(Math.round((row.expiresAt.getTime() - row.createdAt.getTime()) / 86_400_000)).toBe(7)
    expect(await prisma.auditLog.count({ where: { companyId: ids.a, action: 'MEMBER_INVITED' } })).toBe(1)

    const list = await (await call('companyAdmin', 'GET', 'list', { id: ids.a })).json()
    expect(list.invitations.map((i: { email: string }) => i.email)).toEqual(['expert@cabinet.fr'])
  })

  it('returns the link to the inviter when no email can carry it', async () => {
    state.emailEnabled = false
    const body = await (await invite('companyAdmin', 'salarie@atelier.fr', 'viewer')).json()
    expect(body.emailSent).toBe(false)
    expect(body.link).toMatch(/^http:\/\/localhost:3000\/invitation\/[A-Za-z0-9_-]{43}$/)
  })

  it('refuses an accountant, a role above the inviter, the instance administrator role and another company', async () => {
    expect((await invite('accountant', 'x@test.local', 'viewer')).status).toBe(403)
    expect((await invite('companyAdmin', 'x@test.local', 'admin')).status).toBe(400)
    expect((await invite('companyAdmin', 'x@test.local', 'owner')).status).toBe(400)
    expect((await invite('outsider', 'x@test.local', 'viewer')).status).toBe(404)
    expect((await call('accountant', 'GET', 'list', { id: ids.a })).status).toBe(403)

    // A role granting more than the inviter's own roles is never grantable
    expect(service.grantableRoles(['companyAdmin'], false)).toEqual(['companyAdmin', 'accountant', 'viewer'])
    expect(service.grantableRoles(['accountant'], false)).toEqual(['accountant', 'viewer'])
    expect(service.grantableRoles(['viewer'], false)).toEqual(['viewer'])
    await expect(
      service.inviteMember({
        companyId: ids.a,
        email: 'x@test.local',
        role: 'companyAdmin',
        inviter: USERS.accountant,
        inviterCan: (permission) => rolesGrant(['accountant'], permission),
      }),
    ).rejects.toThrow(service.ROLE_ABOVE_INVITER_MESSAGE)
    expect(await prisma.companyInvitation.count()).toBe(0)
  })

  it('keeps one open invitation per address and never invites a member', async () => {
    expect((await invite('companyAdmin', 'expert@cabinet.fr', 'accountant')).status).toBe(201)
    const again = await invite('companyAdmin', 'EXPERT@cabinet.fr', 'viewer')
    expect(again.status).toBe(409)
    expect((await again.json()).error).toBe(service.INVITATION_PENDING_MESSAGE)
    const member = await invite('companyAdmin', 'accountant@test.local', 'viewer')
    expect(member.status).toBe(409)
    expect((await member.json()).error).toBe(service.ALREADY_MEMBER_MESSAGE)
  })

  it('creates the account from the link with a confirmed address and the invited role, once', async () => {
    await invite('companyAdmin', 'expert@cabinet.fr', 'accountant')
    const token = tokenSentTo('expert@cabinet.fr')

    const view = await service.readInvitation(token)
    expect(view).toMatchObject({ state: 'open', companyName: 'Atelier Alpha', email: 'expert@cabinet.fr', roleLabel: 'Comptable', inviterName: 'Claire Admin', confirmedAccount: false, signUpAllowed: true })

    const result = await service.acceptInvitation(token, { newAccount: { name: 'Eva Expert', password: 'motdepasse-solide-42' } })
    expect(result).toMatchObject({ companyId: ids.a, companySlug: 'atelier-alpha', email: 'expert@cabinet.fr', createdUser: true })
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'expert@cabinet.fr' } })
    expect(user).toMatchObject({ name: 'Eva Expert', emailVerified: true, role: 'user' })
    const member = await prisma.member.findFirstOrThrow({ where: { userId: user.id, organizationId: 'org-a' } })
    expect(member.role).toBe('accountant')
    const signIn = await auth.api.signInEmail({ body: { email: 'expert@cabinet.fr', password: 'motdepasse-solide-42' } })
    expect(signIn.user.id).toBe(user.id)
    expect(await prisma.auditLog.count({ where: { companyId: ids.a, action: 'MEMBER_INVITATION_ACCEPTED' } })).toBe(1)

    // Single use
    expect((await service.readInvitation(token))?.state).toBe('accepted')
    await expect(service.acceptInvitation(token, { newAccount: { name: 'Mallory', password: 'autre-mot-de-passe-1' } })).rejects.toThrow(service.INVITATION_UNUSABLE_MESSAGE)
    expect(await prisma.member.count({ where: { organizationId: 'org-a' } })).toBe(3)
  })

  it('links the signed-in invited account, and refuses another account', async () => {
    await invite('companyAdmin', 'outsider@test.local', 'viewer')
    const token = tokenSentTo('outsider@test.local')
    expect((await service.readInvitation(token))?.confirmedAccount).toBe(true)

    // An existing confirmed account signs in: no account is created from the link
    await expect(service.acceptInvitation(token, { newAccount: { name: 'X', password: 'motdepasse-solide-42' } })).rejects.toThrow(service.ACCOUNT_EXISTS_MESSAGE)
    await expect(service.acceptInvitation(token, { user: USERS.accountant })).rejects.toThrow(service.WRONG_ACCOUNT_MESSAGE)
    // Same address, another account id: refused
    await expect(service.acceptInvitation(token, { user: { ...USERS.accountant, email: 'outsider@test.local' } })).rejects.toThrow(service.WRONG_ACCOUNT_MESSAGE)

    const result = await service.acceptInvitation(token, { user: USERS.outsider })
    expect(result).toMatchObject({ createdUser: false, userId: 'u-outsider' })
    expect((await prisma.member.findFirstOrThrow({ where: { userId: 'u-outsider', organizationId: 'org-a' } })).role).toBe('viewer')
  })

  it('takes over an unconfirmed account of the invited address (KLEDG-SEC-011)', async () => {
    const squatter = await auth.api.createUser({ body: { email: 'expert@cabinet.fr', password: 'squatter-password-1', name: 'Squatter', role: 'user' } })
    await invite('companyAdmin', 'expert@cabinet.fr', 'accountant')
    const token = tokenSentTo('expert@cabinet.fr')
    // The squatter, signed in, cannot accept with their session
    await expect(service.acceptInvitation(token, { user: { id: squatter.user.id, email: 'expert@cabinet.fr', role: 'user' } })).rejects.toThrow(/Confirmez/)
    await service.acceptInvitation(token, { newAccount: { name: 'Eva Expert', password: 'motdepasse-solide-42' } })
    await expect(auth.api.signInEmail({ body: { email: 'expert@cabinet.fr', password: 'squatter-password-1' } })).rejects.toThrow()
    expect((await prisma.user.findUniqueOrThrow({ where: { id: squatter.user.id } })).emailVerified).toBe(true)
  })

  it('refuses an expired, revoked or replaced link, and an unknown token', async () => {
    await invite('companyAdmin', 'expert@cabinet.fr', 'accountant')
    const first = tokenSentTo('expert@cabinet.fr')
    const row = await prisma.companyInvitation.findFirstOrThrow({ where: { companyId: ids.a } })

    // Resent: a new link, the first one stops working
    const resent = await call('companyAdmin', 'POST', 'resend', { id: ids.a, invitationId: row.id })
    expect(resent.status).toBe(200)
    const second = tokenSentTo('expert@cabinet.fr')
    expect(second).not.toBe(first)
    expect(await service.readInvitation(first)).toBeNull()
    expect((await prisma.companyInvitation.findUniqueOrThrow({ where: { id: row.id } })).sendCount).toBe(2)

    // Expired
    const later = new Date(Date.now() + 8 * 86_400_000)
    expect((await service.readInvitation(second, later))?.state).toBe('expired')
    await expect(service.acceptInvitation(second, { newAccount: { name: 'E', password: 'motdepasse-solide-42' } }, later)).rejects.toThrow(service.INVITATION_UNUSABLE_MESSAGE)

    // Revoked (another company's administrator cannot reach it)
    expect((await call('outsider', 'DELETE', 'one', { id: ids.b, invitationId: row.id })).status).toBe(404)
    expect((await call('companyAdmin', 'DELETE', 'one', { id: ids.a, invitationId: row.id })).status).toBe(200)
    expect((await service.readInvitation(second))?.state).toBe('revoked')
    await expect(service.acceptInvitation(second, { newAccount: { name: 'E', password: 'motdepasse-solide-42' } })).rejects.toThrow(service.INVITATION_UNUSABLE_MESSAGE)
    expect((await (await call('companyAdmin', 'GET', 'list', { id: ids.a })).json()).invitations).toEqual([])
    expect(await prisma.auditLog.count({ where: { companyId: ids.a, action: { in: ['MEMBER_INVITATION_RESENT', 'MEMBER_INVITATION_REVOKED'] } } })).toBe(2)

    expect(await service.readInvitation('not-a-token')).toBeNull()
    expect(await service.readInvitation('A'.repeat(43))).toBeNull()
    expect(await prisma.user.count({ where: { email: 'expert@cabinet.fr' } })).toBe(0)
  })

  it('follows the instance policy: invitations, and accounts created from a link', async () => {
    state.refused.add('invite-member')
    expect((await invite('companyAdmin', 'expert@cabinet.fr', 'accountant')).status).toBe(403)
    state.refused.clear()

    await invite('companyAdmin', 'expert@cabinet.fr', 'accountant')
    const token = tokenSentTo('expert@cabinet.fr')
    state.refused.add('invitation-sign-up')
    expect((await service.readInvitation(token))?.signUpAllowed).toBe(false)
    await expect(service.acceptInvitation(token, { newAccount: { name: 'E', password: 'motdepasse-solide-42' } })).rejects.toThrow(service.SIGN_UP_REFUSED_MESSAGE)
    expect(await prisma.user.count({ where: { email: 'expert@cabinet.fr' } })).toBe(0)

    // Invitations turned off after the send: the pending link no longer works
    state.refused.clear()
    state.refused.add('invite-member')
    await expect(service.acceptInvitation(token, { newAccount: { name: 'E', password: 'motdepasse-solide-42' } })).rejects.toThrow(/désactivée/)
  })

  it('a read-only company neither invites nor accepts', async () => {
    await invite('companyAdmin', 'expert@cabinet.fr', 'accountant')
    const token = tokenSentTo('expert@cabinet.fr')
    state.readOnly.add(ids.a)
    expect((await invite('companyAdmin', 'other@cabinet.fr', 'viewer')).status).toBe(409)
    await expect(service.acceptInvitation(token, { newAccount: { name: 'E', password: 'motdepasse-solide-42' } })).rejects.toThrow('Société en lecture seule.')
    expect(await prisma.user.count({ where: { email: 'expert@cabinet.fr' } })).toBe(0)
  })

  it('lets an instance administrator invite into any company', async () => {
    expect((await invite('admin', 'expert@cabinet.fr', 'companyAdmin', ids.b)).status).toBe(201)
  })
})
