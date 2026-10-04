/**
 * Account deletion guards: the last instance administrator and the last
 * company administrator of a company cannot delete their account.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  otherAdmins: 0,
  memberships: [] as Array<{ role: string; organizationId: string; company: { id: string; name: string; slug: string } | null }>,
  coMembers: [] as Array<{ organizationId: string; userId: string; role: string }>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { count: vi.fn(async (_args: unknown) => db.otherAdmins) },
    member: {
      findMany: vi.fn(async (args: { where: { userId?: unknown; organizationId?: { in: string[] } } }) => {
        if (args.where.organizationId) {
          return db.coMembers.filter((m) => args.where.organizationId!.in.includes(m.organizationId) && m.role.includes('companyAdmin'))
        }
        return db.memberships.map((m) => ({ role: m.role, organizationId: m.organizationId, organization: { company: m.company } }))
      }),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { checkAccountDeletion, memberRoles } from '../deletion-guards'

const acme = { id: 'c-acme', name: 'Acme', slug: 'acme' }
const lumen = { id: 'c-lumen', name: 'Atelier Lumen', slug: 'atelier-lumen' }

beforeEach(() => {
  db.otherAdmins = 0
  db.memberships = []
  db.coMembers = []
})

describe('memberRoles', () => {
  it('splits role lists', () => {
    expect(memberRoles('companyAdmin, accountant')).toEqual(['companyAdmin', 'accountant'])
    expect(memberRoles('')).toEqual([])
  })
})

describe('checkAccountDeletion', () => {
  it('lets a member without admin roles go', async () => {
    db.memberships = [{ role: 'accountant', organizationId: 'org-acme', company: acme }]
    const check = await checkAccountDeletion({ id: 'u1', role: 'user' })
    expect(check.blockers).toEqual([])
    expect(check.companies).toEqual([{ ...acme, roles: ['accountant'], lastCompanyAdmin: false }])
  })

  it('blocks the last instance administrator', async () => {
    const check = await checkAccountDeletion({ id: 'u1', role: 'admin' })
    expect(check.blockers).toHaveLength(1)
    expect(check.blockers[0]).toContain("seul administrateur de l'instance")
  })

  it("lets an instance administrator go when another one remains", async () => {
    db.otherAdmins = 1
    expect((await checkAccountDeletion({ id: 'u1', role: 'admin' })).blockers).toEqual([])
  })

  it('blocks the last company administrator of a company and names it', async () => {
    db.memberships = [
      { role: 'companyAdmin', organizationId: 'org-acme', company: acme },
      { role: 'companyAdmin', organizationId: 'org-lumen', company: lumen },
    ]
    db.coMembers = [
      { organizationId: 'org-acme', userId: 'u2', role: 'companyAdmin' },
      // Another member of Lumen, but not an administrator.
      { organizationId: 'org-lumen', userId: 'u3', role: 'accountant' },
    ]
    const check = await checkAccountDeletion({ id: 'u1', role: 'user' })
    expect(check.blockers).toHaveLength(1)
    expect(check.blockers[0]).toContain('Atelier Lumen')
    expect(check.blockers[0]).not.toContain('Acme')
    expect(check.companies.map((c) => [c.name, c.lastCompanyAdmin])).toEqual([
      ['Acme', false],
      ['Atelier Lumen', true],
    ])
  })

  it('lists both blockers for the last administrator of the instance and of a company', async () => {
    db.memberships = [{ role: 'companyAdmin', organizationId: 'org-acme', company: acme }]
    const check = await checkAccountDeletion({ id: 'u1', role: 'admin' })
    expect(check.blockers).toHaveLength(2)
  })

  it('only counts administrators who can still sign in', async () => {
    db.otherAdmins = 1
    await checkAccountDeletion({ id: 'u1', role: 'admin' })
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { role: 'admin', OR: [{ banned: null }, { banned: false }], id: { not: 'u1' } },
    })
  })

  it("speaks of another user's account for the instance user management", async () => {
    db.memberships = [{ role: 'companyAdmin', organizationId: 'org-acme', company: acme }]
    const check = await checkAccountDeletion({ id: 'u1', role: 'admin' }, { subject: 'other' })
    expect(check.blockers).toEqual([
      "Ce compte est le seul administrateur de l'instance. Donnez ce rôle à un autre compte avant de le supprimer.",
      'Ce compte est le seul administrateur de la société Acme. Nommez un autre administrateur de la société depuis sa page Membres avant de le supprimer.',
    ])
  })
})
