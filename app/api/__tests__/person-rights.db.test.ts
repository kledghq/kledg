/**
 * Rights of a natural person recorded by a company (GET, PATCH and DELETE
 * /api/companies/[id]/persons/[personId]) against PostgreSQL, through the
 * real route with the session and roles mocked. Skipped without the test
 * database server.
 *
 * RGPD (règlement (UE) 2016/679): access and portability (art. 15 and 20),
 * rectification (art. 16), erasure (art. 17). Erasure does not reach what the
 * law obliges the company to keep (art. 17, 3, b): the books and their
 * supporting records for 10 years (Code de commerce art. L123-22), so an
 * expense claimant keeps its name and auxiliary account on the entries; the
 * shareholding of a current associate must be removed first (the company
 * keeps the composition of its capital, CGI ann. III art. 38 de la liasse,
 * formulaire 2033-F / 2059-F).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const member = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('person_rights')
  return { companyId: '', roles: ['companyAdmin'] as string[] }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'admin@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return {
    ...actual,
    getUserRolesForCompany: vi.fn(async (_userId: string, companyId: string) => (companyId === member.companyId ? member.roles : [])),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'

const available = await testDatabaseAvailable()

type Method = 'GET' | 'PATCH' | 'DELETE'
type Handler = (request: NextRequest, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
let route: Record<Method, Handler>
const ids = {} as Record<string, string>

function call(method: Method, personId: string, body?: unknown, companyId = ids.company) {
  const request = new NextRequest(`http://localhost/api/companies/${companyId}/persons/${personId}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return route[method](request, { params: Promise.resolve({ id: companyId, personId }) })
}

describe.skipIf(!available)('rights of a person (RGPD art. 15 to 17)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('person_rights')
    ;({ prisma } = await import('@/lib/prisma'))
    route = (await import('@/app/api/companies/[id]/persons/[personId]/route')) as unknown as Record<Method, Handler>
  })

  beforeEach(async () => {
    await prepareTestDatabase('person_rights')
    member.roles = ['companyAdmin']
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
    await seedMembership(prisma, 'user-1', company.id)
    member.companyId = company.id
    const address = await prisma.address.create({ data: { companyId: company.id, street: '3 rue des Lilas', postalCode: '69001', city: 'Lyon', country: 'FR' } })
    const claimant = await prisma.person.create({
      data: {
        companyId: company.id,
        firstName: 'Claire',
        name: 'Martin',
        email: 'claire@example.fr',
        phone: '0601020304',
        addressId: address.id,
        birthDate: new Date('1985-04-12T00:00:00Z'),
        birthCity: 'Lyon',
        notes: 'Commerciale',
      },
    })
    await prisma.expenseClaimant.create({
      data: { companyId: company.id, kind: 'EMPLOYEE', name: 'Claire Martin', personId: claimant.id, auxiliaryAccountNumber: 'S00001' },
    })
    const associate = await prisma.person.create({ data: { companyId: company.id, firstName: 'Paul', name: 'Durand' } })
    await prisma.shareholder.create({ data: { companyId: company.id, type: 'PHYSICAL', personId: associate.id, sharePercentage: 60 } })
    const foreign = await prisma.person.create({ data: { companyId: other.id, firstName: 'Ines', name: 'Roux' } })
    Object.assign(ids, { company: company.id, other: other.id, address: address.id, claimant: claimant.id, associate: associate.id, foreign: foreign.id })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('gives every data held on the person, with its links (access and portability)', async () => {
    const response = await call('GET', ids.claimant)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      person: {
        id: ids.claimant,
        firstName: 'Claire',
        name: 'Martin',
        email: 'claire@example.fr',
        phone: '0601020304',
        birthDate: '1985-04-12',
        birthCity: 'Lyon',
        notes: 'Commerciale',
        address: { street: '3 rue des Lilas', city: 'Lyon' },
      },
      shareholdings: [],
      expenseClaimants: [{ name: 'Claire Martin', auxiliaryAccountNumber: 'S00001' }],
      retention: expect.stringContaining('L123-22'),
    })
  })

  it('rectifies the data of the person', async () => {
    const response = await call('PATCH', ids.claimant, { email: 'claire.martin@example.fr', phone: '', birthCity: 'Villeurbanne' })
    expect(response.status).toBe(200)
    const stored = await prisma.person.findUniqueOrThrow({ where: { id: ids.claimant } })
    expect(stored).toMatchObject({ email: 'claire.martin@example.fr', phone: null, birthCity: 'Villeurbanne', firstName: 'Claire' })
  })

  it('erases a person, keeping what the books need (claimant name and account), and the unused address', async () => {
    const response = await call('DELETE', ids.claimant)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ erased: true, kept: [expect.stringContaining('note de frais')] })
    expect(await prisma.person.count({ where: { id: ids.claimant } })).toBe(0)
    expect(await prisma.address.count({ where: { id: ids.address } })).toBe(0)
    const claimant = await prisma.expenseClaimant.findFirstOrThrow({ where: { companyId: ids.company } })
    expect(claimant).toMatchObject({ personId: null, name: 'Claire Martin', auxiliaryAccountNumber: 'S00001' })
  })

  it('refuses to erase a current associate until the shareholding is removed', async () => {
    const response = await call('DELETE', ids.associate)
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('associé')
    expect(await prisma.person.count({ where: { id: ids.associate } })).toBe(1)
  })

  it("never reaches another company's person, and needs the settings right to change one", async () => {
    expect((await call('GET', ids.foreign)).status).toBe(404)
    expect((await call('DELETE', ids.foreign)).status).toBe(404)
    member.roles = ['viewer']
    expect((await call('GET', ids.claimant)).status).toBe(200)
    expect((await call('PATCH', ids.claimant, { notes: 'x' })).status).toBe(403)
    expect((await call('DELETE', ids.claimant)).status).toBe(403)
  })
})
