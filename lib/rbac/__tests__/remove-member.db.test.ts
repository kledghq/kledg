/**
 * Removing a member of a company, or leaving it
 * (docs/membres-et-invitations.md#retrait-dun-membre), against PostgreSQL
 * through the route handlers (only the session, the instance policy and the
 * mail delivery mocked):
 * - a company administrator removes a member; an accountant (no
 *   members:manage) cannot; an instance administrator is never removed by a
 *   company administrator; the last member able to manage the members is
 *   never removed, nor leaves; a banned administrator does not count;
 * - a member id of another company is a 404, through either company's URL;
 * - the removal ends access: membership rows deleted, sessions' active
 *   organization cleared, grants of the company deleted (other companies
 *   kept), pending and approved AI actions of the company cancelled (others
 *   kept), open invitations they sent revoked; their account and what they
 *   recorded stay;
 * - audit entry, email notice (none with notify=false or when leaving),
 *   instance policy 'remove-member', read-only company;
 * - two administrators removing each other at once: one succeeds;
 * - the members list says, per member, whether the viewer may remove them,
 *   and carries the instance policy's refusal ('remove-member') on every
 *   member, leaving included, when the policy refuses the viewer.
 * Runs under KLEDG_RLS=enforce too. Skipped when the test database server is
 * unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('member_removal')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return {
    user: null as null | { id: string; email: string; name: string | null; role: string | null },
    emailEnabled: true,
    mails: [] as Array<{ to: string; subject: string; text: string; html: string }>,
    refused: new Set<string>(),
    /** Users the instance policy refuses 'remove-member', the others keep it. */
    removalRefusedTo: new Set<string>(),
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
  isActionAllowed: async (action: string, actor: { id: string } | null = null) =>
    !state.refused.has(action) && !(action === 'remove-member' && actor && state.removalRefusedTo.has(actor.id)),
  companyWriteRefusal: async (companyId: string) => (state.readOnly.has(companyId) ? { message: 'Société en lecture seule.' } : null),
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
let routes: { members: Record<string, Handler>; member: Record<string, Handler>; membership: Record<string, Handler> }

const USERS = {
  admin: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' },
  cadmin: { id: 'u-cadmin', email: 'cadmin@test.local', name: 'Claire Admin', role: 'user' },
  cadmin2: { id: 'u-cadmin2', email: 'cadmin2@test.local', name: 'Chloé Admin', role: 'user' },
  accountant: { id: 'u-accountant', email: 'accountant@test.local', name: 'Paul Compta', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Vera Viewer', role: 'user' },
  outsider: { id: 'u-outsider', email: 'outsider@test.local', name: 'Other', role: 'user' },
} as const
type Who = keyof typeof USERS
const ids = {} as Record<string, string>

async function call(who: Who, method: string, route: keyof typeof routes, params: Record<string, string>, search = '') {
  state.user = { ...USERS[who] }
  const path =
    route === 'membership'
      ? `/api/companies/${params.id}/membership`
      : `/api/companies/${params.id}/members${params.memberId ? `/${params.memberId}` : ''}`
  return routes[route][method](new NextRequest(`http://localhost${path}${search}`, { method }), { params: Promise.resolve(params) })
}

const remove = (who: Who, memberId: string, companyId = ids.a, search = '') => call(who, 'DELETE', 'member', { id: companyId, memberId }, search)
const leave = (who: Who, companyId = ids.a) => call(who, 'DELETE', 'membership', { id: companyId })
const isMember = async (userId: string, companyId = ids.a) => (await prisma.member.count({ where: { userId, organization: { companyId } } })) > 0

async function seed() {
  for (const user of Object.values(USERS)) await prisma.user.create({ data: { ...user, emailVerified: true } })
  for (const [key, name, slug, siren] of [['a', 'Atelier Alpha', 'atelier-alpha', '111111111'], ['b', 'Bureau Beta', 'bureau-beta', '222222222']]) {
    const company = await prisma.company.create({ data: { name, slug, siren } })
    await prisma.organization.create({ data: { id: `org-${key}`, name, slug, companyId: company.id, createdAt: new Date() } })
    ids[key] = company.id
  }
  const members: Array<[string, string, string]> = [
    ['u-cadmin', 'org-a', 'companyAdmin'],
    ['u-accountant', 'org-a', 'accountant'],
    ['u-viewer', 'org-a', 'viewer'],
    ['u-accountant', 'org-b', 'accountant'],
    ['u-outsider', 'org-b', 'companyAdmin'],
  ]
  for (const [userId, organizationId, role] of members) {
    await prisma.member.create({ data: { id: `m-${organizationId}-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }
}

/** Everything the accountant has around company A (and B, which must stay). */
async function seedAccountantFootprint() {
  const later = new Date(Date.now() + 86_400_000)
  for (const [id, org] of [['s-a', 'org-a'], ['s-b', 'org-b']]) {
    await prisma.session.create({ data: { id, token: `token-${id}`, userId: 'u-accountant', expiresAt: later, activeOrganizationId: org } })
  }
  await prisma.apikey.create({ data: { id: 'key-1', key: 'hashed-key', referenceId: 'u-accountant', createdAt: new Date(), updatedAt: new Date() } })
  await prisma.aiAccessGrant.create({
    data: { id: 'grant-1', userId: 'u-accountant', apiKeyId: 'key-1', allCompanies: false, companies: { create: [{ companyId: ids.a }, { companyId: ids.b }] } },
  })
  const action = (id: string, companyId: string, status: string) =>
    prisma.mcpPendingAction.create({
      data: { id, userId: 'u-accountant', caller: 'apiKey:key-1', tool: 'validate_entries', companyId, args: {}, argsHash: 'h', preview: {}, status, expiresAt: later },
    })
  await action('act-pending', ids.a, 'pending')
  await action('act-approved', ids.a, 'approved')
  await action('act-executed', ids.a, 'executed')
  await action('act-b', ids.b, 'pending')
  await prisma.companyInvitation.create({
    data: { id: 'inv-sent', companyId: ids.a, email: 'friend@test.local', role: 'viewer', tokenHash: 'a'.repeat(64), invitedById: 'u-accountant', expiresAt: later },
  })
  await prisma.expenseClaimant.create({ data: { companyId: ids.a, kind: 'EMPLOYEE', name: 'Paul Compta', userId: 'u-accountant', auxiliaryAccountNumber: 'PAUL' } })
  await prisma.auditLog.create({ data: { action: 'CREATE_ENTRY', message: 'Écriture créée', companyId: ids.a, userId: 'accountant@test.local' } })
}

describe.skipIf(!available)('removing a member of a company', () => {
  beforeAll(async () => {
    await prepareTestDatabase('member_removal')
    ;({ prisma } = await import('@/lib/prisma'))
    routes = {
      members: (await import('@/app/api/companies/[id]/members/route')) as unknown as Record<string, Handler>,
      member: (await import('@/app/api/companies/[id]/members/[memberId]/route')) as unknown as Record<string, Handler>,
      membership: (await import('@/app/api/companies/[id]/membership/route')) as unknown as Record<string, Handler>,
    }
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('member_removal')
    state.emailEnabled = true
    state.mails.length = 0
    state.refused.clear()
    state.removalRefusedTo.clear()
    state.readOnly.clear()
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('lets a company administrator remove a member, ending their access to this company only', async () => {
    await seedAccountantFootprint()
    const response = await remove('cadmin', 'm-org-a-u-accountant')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, userId: 'u-accountant', self: false, revokedGrants: 1, cancelledActions: 2, revokedInvitations: 1, emailSent: true })

    expect(await isMember('u-accountant')).toBe(false)
    expect(await isMember('u-accountant', ids.b)).toBe(true)
    // Sessions: the active organization of A is cleared, B's kept
    const sessions = await prisma.session.findMany({ where: { userId: 'u-accountant' }, orderBy: { id: 'asc' }, select: { id: true, activeOrganizationId: true } })
    expect(sessions).toEqual([{ id: 's-a', activeOrganizationId: null }, { id: 's-b', activeOrganizationId: 'org-b' }])
    // The key keeps B only: being added back to A never revives its grant
    expect((await prisma.aiAccessGrantCompany.findMany({ where: { grantId: 'grant-1' } })).map((g) => g.companyId)).toEqual([ids.b])
    expect(await prisma.apikey.count({ where: { id: 'key-1' } })).toBe(1)
    // AI actions of A waiting or approved are cancelled; an executed one and B's are kept
    const actions = Object.fromEntries((await prisma.mcpPendingAction.findMany()).map((a) => [a.id, a.status]))
    expect(actions).toEqual({ 'act-pending': 'rejected', 'act-approved': 'rejected', 'act-executed': 'executed', 'act-b': 'pending' })
    expect((await prisma.companyInvitation.findUniqueOrThrow({ where: { id: 'inv-sent' } })).revokedAt).not.toBeNull()
    // What they recorded stays, with their name; the account stays
    expect(await prisma.expenseClaimant.findFirst({ where: { companyId: ids.a, userId: 'u-accountant' }, select: { name: true } })).toEqual({ name: 'Paul Compta' })
    expect(await prisma.auditLog.count({ where: { action: 'CREATE_ENTRY', userId: 'accountant@test.local' } })).toBe(1)
    expect(await prisma.user.count({ where: { id: 'u-accountant' } })).toBe(1)

    // Audited: who removed whom, with which role
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { companyId: ids.a, action: 'MEMBER_REMOVED' } })
    expect(audit.userId).toBe('cadmin@test.local')
    expect(audit.metadata).toMatchObject({ userId: 'u-accountant', email: 'accountant@test.local', name: 'Paul Compta', role: 'accountant', removedById: 'u-cadmin', self: false })
    // Notice to the person removed
    expect(state.mails).toHaveLength(1)
    expect(state.mails[0]).toMatchObject({ to: 'accountant@test.local' })
    expect(state.mails[0].text).toContain('Atelier Alpha')
    expect(state.mails[0].text).toContain('Claire Admin')

    // The removed member reaches company A no more
    expect((await call('accountant', 'GET', 'members', { id: ids.a })).status).toBe(404)
  })

  it('sends no notice with notify=false', async () => {
    expect((await remove('cadmin', 'm-org-a-u-viewer', ids.a, '?notify=false')).status).toBe(200)
    expect(state.mails).toHaveLength(0)
    expect(await isMember('u-viewer')).toBe(false)
  })

  it('refuses a member without members:manage', async () => {
    expect((await remove('accountant', 'm-org-a-u-viewer')).status).toBe(403)
    expect((await remove('viewer', 'm-org-a-u-accountant')).status).toBe(403)
    expect(await isMember('u-viewer')).toBe(true)
    expect(await isMember('u-accountant')).toBe(true)
  })

  it('never lets a company administrator remove an instance administrator; an instance administrator removes anyone', async () => {
    await prisma.member.create({ data: { id: 'm-org-a-u-admin', userId: 'u-admin', organizationId: 'org-a', role: 'viewer', createdAt: new Date() } })
    const refused = await remove('cadmin', 'm-org-a-u-admin')
    expect(refused.status).toBe(403)
    expect((await refused.json()).error).toMatch(/administrateur de l'instance/)
    expect(await isMember('u-admin')).toBe(true)
    // The instance administrator removes even the last company administrator
    expect((await remove('admin', 'm-org-a-u-cadmin')).status).toBe(200)
    expect(await isMember('u-cadmin')).toBe(false)
  })

  it('never removes the last member able to manage the members, nor lets them leave', async () => {
    const leaving = await leave('cadmin')
    expect(leaving.status).toBe(409)
    expect((await leaving.json()).error).toMatch(/dernier administrateur/)
    expect(await isMember('u-cadmin')).toBe(true)

    // A second administrator: then one may remove the other, and the last one stays
    await prisma.member.create({ data: { id: 'm-org-a-u-cadmin2', userId: 'u-cadmin2', organizationId: 'org-a', role: 'companyAdmin', createdAt: new Date() } })
    expect((await remove('cadmin', 'm-org-a-u-cadmin2')).status).toBe(200)
    expect((await leave('cadmin')).status).toBe(409)

    // A banned administrator manages nothing: they do not count
    await prisma.member.create({ data: { id: 'm-org-a-u-cadmin2', userId: 'u-cadmin2', organizationId: 'org-a', role: 'companyAdmin', createdAt: new Date() } })
    await prisma.user.update({ where: { id: 'u-cadmin2' }, data: { banned: true } })
    expect((await leave('cadmin')).status).toBe(409)
    await prisma.user.update({ where: { id: 'u-cadmin2' }, data: { banned: false } })
    expect((await leave('cadmin')).status).toBe(200)
    expect(await isMember('u-cadmin')).toBe(false)
  })

  it('lets two administrators removing each other at once succeed only once', async () => {
    await prisma.member.create({ data: { id: 'm-org-a-u-cadmin2', userId: 'u-cadmin2', organizationId: 'org-a', role: 'companyAdmin', createdAt: new Date() } })
    const [first, second] = await Promise.all([remove('cadmin', 'm-org-a-u-cadmin2'), remove('cadmin2', 'm-org-a-u-cadmin')])
    const statuses = [first.status, second.status]
    expect(statuses.filter((s) => s === 200)).toHaveLength(1)
    // The other one is refused: no longer a manager under the lock (403), or no longer a member at all (404)
    expect([403, 404]).toContain(statuses.find((s) => s !== 200))
    const managers = await prisma.member.count({ where: { organizationId: 'org-a', role: 'companyAdmin' } })
    expect(managers).toBe(1)
  })

  it('answers 404 for a member of another company, through either URL', async () => {
    // Company A's URL with company B's member
    expect((await remove('cadmin', 'm-org-b-u-outsider')).status).toBe(404)
    // Company B's URL: not a member there
    expect((await remove('cadmin', 'm-org-b-u-outsider', ids.b)).status).toBe(404)
    expect((await remove('outsider', 'm-org-a-u-viewer')).status).toBe(404)
    expect(await isMember('u-outsider', ids.b)).toBe(true)
    expect(await isMember('u-viewer')).toBe(true)
  })

  it('lets any member leave the company, without a notice', async () => {
    const response = await leave('viewer')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ self: true, emailSent: false })
    expect(await isMember('u-viewer')).toBe(false)
    expect(state.mails).toHaveLength(0)
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { companyId: ids.a, action: 'MEMBER_REMOVED' } })
    expect(audit.metadata).toMatchObject({ userId: 'u-viewer', self: true, removedById: 'u-viewer' })
    // Not a member any more: 404
    expect((await leave('viewer')).status).toBe(404)
  })

  it('follows the instance policy and a read-only company', async () => {
    state.refused.add('remove-member')
    expect((await remove('cadmin', 'm-org-a-u-viewer')).status).toBe(403)
    expect((await leave('viewer')).status).toBe(403)
    state.refused.clear()
    state.readOnly.add(ids.a)
    expect((await remove('cadmin', 'm-org-a-u-viewer')).status).toBeGreaterThanOrEqual(400)
    expect(await isMember('u-viewer')).toBe(true)
  })

  it('lists the members with whether the user looking may remove each one, and why not', async () => {
    const asAdmin = (await (await call('cadmin', 'GET', 'members', { id: ids.a })).json()) as Array<{ id: string; self: boolean; removal: { allowed: boolean; reason?: string } }>
    const byId = Object.fromEntries(asAdmin.map((m) => [m.id, m]))
    expect(byId['m-org-a-u-accountant'].removal).toEqual({ allowed: true })
    expect(byId['m-org-a-u-cadmin']).toMatchObject({ self: true, removal: { allowed: false, reason: expect.stringMatching(/dernier administrateur/) } })

    const asViewer = (await (await call('viewer', 'GET', 'members', { id: ids.a })).json()) as typeof asAdmin
    const viewerById = Object.fromEntries(asViewer.map((m) => [m.id, m]))
    expect(viewerById['m-org-a-u-viewer']).toMatchObject({ self: true, removal: { allowed: true } })
    expect(viewerById['m-org-a-u-accountant'].removal).toEqual({ allowed: false, reason: 'Seuls les administrateurs de la société peuvent retirer un membre.' })
  })

  it("lists every removal, leaving included, as refused with the instance policy's message when the policy refuses the viewer", async () => {
    type Listed = Array<{ id: string; self: boolean; removal: { allowed: boolean; reason?: string } }>
    const { actionRefusalMessage } = await import('@/lib/instance')
    const message = actionRefusalMessage('remove-member')
    const list = async (who: Who) => {
      const response = await call(who, 'GET', 'members', { id: ids.a })
      expect(response.status).toBe(200)
      return (await response.json()) as Listed
    }

    state.refused.add('remove-member')
    for (const who of ['cadmin', 'viewer'] as const) {
      const members = await list(who)
      expect(members).toHaveLength(3)
      for (const m of members) expect(m.removal).toEqual({ allowed: false, reason: message })
      expect(members.find((m) => m.self)?.removal).toEqual({ allowed: false, reason: message })
    }
    expect((await remove('cadmin', 'm-org-a-u-viewer')).status).toBe(403)

    // Decided per actor: refused to the company administrator only, the viewer still leaves.
    state.refused.clear()
    state.removalRefusedTo.add('u-cadmin')
    for (const m of await list('cadmin')) expect(m.removal).toEqual({ allowed: false, reason: message })
    const asViewer = await list('viewer')
    expect(asViewer.find((m) => m.self)?.removal).toEqual({ allowed: true })
    expect((await remove('cadmin', 'm-org-a-u-viewer')).status).toBe(403)
    expect((await leave('viewer')).status).toBe(200)
    expect(await isMember('u-viewer')).toBe(false)
  })
})
