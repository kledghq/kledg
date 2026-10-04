/**
 * Persons of a company (GET and POST /api/companies/[id]/persons) against
 * PostgreSQL, through the real route handler with only the session mocked.
 * The shareholders section of the Informations page lists and creates
 * natural persons here. Checks that:
 * - the list holds the company's persons and its shareholders, never another
 *   company's persons;
 * - a new person belongs to the company and its address is an address of
 *   the company (Address.companyId), reusing an identical one;
 * - an email is unique within the company only, so creating a person never
 *   reveals that another company uses that address;
 * - creation needs settings update (a viewer is refused), a non member gets
 *   a 404, and input is validated with French messages.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('persons')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

let prisma: typeof import('@/lib/prisma').prisma
let route: Record<'GET' | 'POST', Handler>

const USERS = {
  companyAdmin: { id: 'u-cadmin', email: 'cadmin@test.local', name: 'Company admin', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' },
  memberB: { id: 'u-member-b', email: 'b@test.local', name: 'Member of B', role: 'user' },
} as const
type Who = keyof typeof USERS

const ids = {} as Record<string, string>
const A = () => ids.aCompany
const B = () => ids.bCompany

function call(who: Who, method: 'GET' | 'POST', companyId: string, body?: unknown): Promise<Response> {
  state.user = { ...USERS[who] }
  const request = new NextRequest(`http://localhost/api/companies/${companyId}/persons`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
  return route[method](request, { params: Promise.resolve({ id: companyId }) })
}

const PAIX = { street: '1 rue de la Paix', postalCode: '75002', city: 'Paris', country: 'FR' }

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  }
  for (const [prefix, name, slug, siren] of [
    ['a', 'Atelier Alpha', 'atelier-alpha', '111111111'],
    ['b', 'Bureau Beta', 'bureau-beta', '222222222'],
  ] as const) {
    const company = await prisma.company.create({ data: { name, slug, siren } })
    await prisma.organization.create({ data: { id: `org-${prefix}`, name, slug: `org-${slug}`, createdAt: new Date(), companyId: company.id } })
    ids[`${prefix}Company`] = company.id
  }
  for (const [userId, organizationId, role] of [
    ['u-cadmin', 'org-a', 'companyAdmin'],
    ['u-viewer', 'org-a', 'viewer'],
    ['u-member-b', 'org-b', 'companyAdmin'],
  ]) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }

  // A: a person of its own, and an outside person who is one of its shareholders
  const own = await prisma.person.create({ data: { firstName: 'Alice', name: 'Martin', companyId: A() } })
  const outsider = await prisma.person.create({ data: { firstName: 'Paul', name: 'Petit' } })
  await prisma.shareholder.create({ data: { companyId: A(), type: 'PHYSICAL', personId: outsider.id, sharePercentage: 10 } })
  // B: a person of its own, and A's headquarters-like address it must never reuse
  const bPerson = await prisma.person.create({ data: { firstName: 'Bruno', name: 'Durand', companyId: B() } })
  const bPaix = await prisma.address.create({ data: { companyId: B(), ...PAIX } })
  Object.assign(ids, { own: own.id, outsider: outsider.id, bPerson: bPerson.id, bPaix: bPaix.id })
}

describe.skipIf(!available)('company persons route', () => {
  beforeAll(async () => {
    await prepareTestDatabase('persons')
    ;({ prisma } = await import('@/lib/prisma'))
    route = (await import('@/app/api/companies/[id]/persons/route')) as unknown as Record<'GET' | 'POST', Handler>
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('persons')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it("lists the company's persons and its shareholders, never another company's", async () => {
    const response = await call('viewer', 'GET', A())
    expect(response.status).toBe(200)
    const listed = ((await response.json()) as Array<{ id: string }>).map((p) => p.id).sort()
    expect(listed).toEqual([ids.own, ids.outsider].sort())
    expect(listed).not.toContain(ids.bPerson)
  })

  it('creates a person of the company with an address of the company, never reusing another company’s', async () => {
    const response = await call('companyAdmin', 'POST', A(), {
      firstName: ' Jeanne ',
      name: 'Leroy',
      email: 'Jeanne.Leroy@Example.fr',
      address: PAIX,
    })
    expect(response.status).toBe(201)
    const created = (await response.json()) as { id: string; email: string }
    expect(created.email).toBe('jeanne.leroy@example.fr')
    const person = await prisma.person.findUniqueOrThrow({ where: { id: created.id }, include: { address: true } })
    expect(person.companyId).toBe(A())
    expect(person.firstName).toBe('Jeanne')
    expect(person.address?.companyId).toBe(A())
    expect(person.addressId).not.toBe(ids.bPaix)

    // A second person at the same address reuses A's address, not a new row.
    const second = await call('companyAdmin', 'POST', A(), { firstName: 'Marc', name: 'Leroy', address: PAIX })
    const secondPerson = await prisma.person.findUniqueOrThrow({ where: { id: ((await second.json()) as { id: string }).id } })
    expect(secondPerson.addressId).toBe(person.addressId)
  })

  it("does not reveal another company's persons: an email used in company B is accepted in A, refused twice in A", async () => {
    await prisma.person.update({ where: { id: ids.bPerson }, data: { email: 'bruno@example.fr' } })
    const first = await call('companyAdmin', 'POST', A(), { firstName: 'Bruno', name: 'Autre', email: 'bruno@example.fr' })
    expect(first.status).toBe(201)
    const again = await call('companyAdmin', 'POST', A(), { firstName: 'Bruno', name: 'Encore', email: 'bruno@example.fr' })
    expect(again.status).toBe(409)
  })

  it('creates a person without address, email or phone', async () => {
    const response = await call('companyAdmin', 'POST', A(), { firstName: 'Lou', name: 'Bernard', email: '', address: null })
    expect(response.status).toBe(201)
    const person = await prisma.person.findUniqueOrThrow({ where: { id: ((await response.json()) as { id: string }).id } })
    expect(person).toMatchObject({ companyId: A(), email: null, phone: null, addressId: null })
  })

  it('refuses a viewer (403), a non member (404) and invalid input (400, French message)', async () => {
    expect((await call('viewer', 'POST', A(), { firstName: 'X', name: 'Y' })).status).toBe(403)
    expect((await call('memberB', 'POST', A(), { firstName: 'X', name: 'Y' })).status).toBe(404)
    expect((await call('memberB', 'GET', A())).status).toBe(404)
    const invalid = await call('companyAdmin', 'POST', A(), { firstName: '', name: 'Y', email: 'pas-un-email' })
    expect(invalid.status).toBe(400)
    expect(((await invalid.json()) as { error: string }).error).toMatch(/prénom|email/i)
    const photo = await call('companyAdmin', 'POST', A(), { firstName: 'X', name: 'Y', photo: 'javascript:alert(1)' })
    expect(photo.status).toBe(400)
  })
})
