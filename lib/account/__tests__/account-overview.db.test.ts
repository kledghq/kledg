/**
 * getAccountOverview (lib/account/account-overview.ts) against PostgreSQL,
 * with the instance policy and the email configuration mocked: the profile
 * read from the database, the email change mode, and the password and
 * deletion actions with the policy's French refusal and the deletion guards
 * (lib/account/deletion-guards.ts).
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_bank_account_overview')
  return { refused: new Set<string>(), emailEnabled: false }
})

vi.mock('@/lib/instance/policy', () => ({
  isActionAllowed: async (action: string) => !state.refused.has(action),
  actionRefusalMessage: (action: string) => `Action ${action} refusée sur cette instance.`,
  SELF_AUTHENTICATED_API_ROUTES: {},
}))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(), isEmailEnabled: async () => state.emailEnabled }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { NotFoundError } from '@/lib/accounting/errors'
import { EMAIL_CHANGE_UNAVAILABLE_MESSAGE } from '@/lib/account/change-email.service'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let getAccountOverview: typeof import('@/lib/account/account-overview').getAccountOverview

const MARIE = { id: 'u-marie', email: 'marie@example.fr', name: 'Marie', role: 'user' }
const ADMIN = { id: 'u-admin', email: 'admin@example.fr', name: 'Admin', role: 'admin' }

describe.skipIf(!available)('getAccountOverview', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_bank_account_overview')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ getAccountOverview } = await import('@/lib/account/account-overview'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('cov_bank_account_overview')
    state.refused = new Set()
    state.emailEnabled = false
    await prisma.user.create({ data: { id: MARIE.id, email: MARIE.email, name: 'Marie Durand', emailVerified: true, role: 'user' } })
    await prisma.user.create({ data: { id: ADMIN.id, email: ADMIN.email, name: 'Admin', role: 'admin' } })
    for (const [n, name] of [
      [1, 'Bureau Beta'],
      [2, 'Atelier Alpha'],
    ] as const) {
      const company = await prisma.company.create({ data: { id: `c-${n}`, name, slug: `societe-${n}`, siren: `${n}`.repeat(9) } })
      await prisma.organization.create({ data: { id: `org-${n}`, name, slug: `org-${n}`, createdAt: new Date(), companyId: company.id } })
    }
    // Marie: sole administrator of Atelier Alpha, accountant of Bureau Beta
    await prisma.member.create({ data: { id: 'm-1', userId: MARIE.id, organizationId: 'org-2', role: 'companyAdmin', createdAt: new Date() } })
    await prisma.member.create({ data: { id: 'm-2', userId: MARIE.id, organizationId: 'org-1', role: 'accountant', createdAt: new Date() } })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('reads the profile from the database and lists the companies with the deletion blocker', async () => {
    const overview = await getAccountOverview({ ...MARIE, name: 'Ancien nom en session' })
    expect(overview).toEqual({
      profile: { name: 'Marie Durand', email: 'marie@example.fr', emailVerified: true, isAdmin: false },
      email: { kind: 'unavailable', message: EMAIL_CHANGE_UNAVAILABLE_MESSAGE },
      password: { allowed: true },
      deletion: {
        allowed: true,
        blockers: [
          "Vous êtes le seul administrateur de la société Atelier Alpha. Nommez un autre administrateur de la société depuis sa page Membres avant de supprimer votre compte.",
        ],
        companies: [
          { id: 'c-2', name: 'Atelier Alpha', slug: 'societe-2', roles: ['companyAdmin'], lastCompanyAdmin: true },
          { id: 'c-1', name: 'Bureau Beta', slug: 'societe-1', roles: ['accountant'], lastCompanyAdmin: false },
        ],
      },
    })
  })

  it('lifts the company blocker once another administrator exists', async () => {
    await prisma.member.create({ data: { id: 'm-3', userId: ADMIN.id, organizationId: 'org-2', role: 'accountant,companyAdmin', createdAt: new Date() } })
    const { deletion } = await getAccountOverview(MARIE)
    expect(deletion.blockers).toEqual([])
    expect(deletion.companies.map((c) => c.lastCompanyAdmin)).toEqual([false, false])
  })

  it('carries the policy refusal of the password and deletion actions', async () => {
    state.refused = new Set(['change-password', 'delete-account', 'change-email'])
    const overview = await getAccountOverview(MARIE)
    expect(overview.password).toEqual({ allowed: false, message: 'Action change-password refusée sur cette instance.' })
    expect(overview.deletion).toMatchObject({ allowed: false, message: 'Action delete-account refusée sur cette instance.' })
    expect(overview.email).toEqual({ kind: 'refused', message: 'Action change-email refusée sur cette instance.' })
  })

  it('flags the only instance administrator, who changes the email directly without email delivery', async () => {
    const overview = await getAccountOverview(ADMIN)
    expect(overview.profile).toEqual({ name: 'Admin', email: 'admin@example.fr', emailVerified: false, isAdmin: true })
    expect(overview.email).toEqual({ kind: 'direct' })
    expect(overview.deletion.blockers).toEqual([
      "Vous êtes le seul administrateur de l'instance. Donnez ce rôle à un autre compte avant de supprimer le vôtre.",
    ])
    state.emailEnabled = true
    expect((await getAccountOverview(MARIE)).email).toEqual({ kind: 'verify' })
  })

  it('answers 404 for an account deleted meanwhile', async () => {
    await expect(getAccountOverview({ id: 'u-gone', email: 'gone@example.fr', name: null, role: 'user' })).rejects.toThrow(
      new NotFoundError('Compte introuvable'),
    )
  })
})
