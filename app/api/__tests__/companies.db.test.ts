/**
 * Company settings routes against PostgreSQL (lib/__tests__/helpers/test-db.ts),
 * through the real route handlers with only the session mocked:
 * - company profile: validation (SIREN, legal form, dates, colors) with
 *   French 400s, SIREN and slug conflicts (409), calendar-day dates, share
 *   capital in cents;
 * - establishments: one main establishment, headquarters address in sync,
 *   SIRET conflicts, soft delete handing over the main role, scoping;
 * - shareholders: 100 % cap, persons and shareholder companies of the
 *   company only, scoping;
 * - tax regimes: closing the open regime the day before, scoping;
 * - members and users search (instance administrators).
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('companies')
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
type Prisma = typeof import('@/lib/prisma').prisma
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

let prisma: Prisma
const routes: Record<string, Record<string, Handler>> = {}

const ROUTE_MODULES = {
  company: () => import('@/app/api/companies/[id]/route'),
  establishments: () => import('@/app/api/companies/[id]/establishments/route'),
  establishment: () => import('@/app/api/companies/[id]/establishments/[establishmentId]/route'),
  shareholders: () => import('@/app/api/companies/[id]/shareholders/route'),
  shareholder: () => import('@/app/api/companies/[id]/shareholders/[shareholderId]/route'),
  taxRegimes: () => import('@/app/api/companies/[id]/tax-regimes/route'),
  members: () => import('@/app/api/companies/[id]/members/route'),
  member: () => import('@/app/api/companies/[id]/members/[memberId]/route'),
  users: () => import('@/app/api/users/route'),
  lookup: () => import('@/app/api/companies/lookup/route'),
}

const USERS = {
  admin: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' },
  companyAdmin: { id: 'u-cadmin', email: 'cadmin@test.local', name: 'Company admin', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' },
  memberB: { id: 'u-member-b', email: 'b@test.local', name: 'Member of B', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const ids = {} as Record<string, string>

async function call(
  who: Who,
  route: keyof typeof ROUTE_MODULES,
  method: Method,
  path: string,
  options: { params?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
  return routes[route][method](request, { params: Promise.resolve(options.params ?? {}) })
}

const A = () => ids.aCompany
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

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
  const address = await prisma.address.create({ data: { companyId: ids.aCompany, street: '1 rue de la Paix', postalCode: '75002', city: 'Paris' } })
  ids.address = address.id
  const personA = await prisma.person.create({ data: { firstName: 'Alice', name: 'Martin', companyId: ids.aCompany } })
  const personB = await prisma.person.create({ data: { firstName: 'Bruno', name: 'Durand', companyId: ids.bCompany } })
  ids.personA = personA.id
  ids.personB = personB.id
}

describe.skipIf(!available)('company settings routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('companies')
    ;({ prisma } = await import('@/lib/prisma'))
    for (const [name, load] of Object.entries(ROUTE_MODULES)) {
      routes[name] = (await load()) as unknown as Record<string, Handler>
    }
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('companies')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('PATCH /api/companies/[id]', () => {
    const patch = (body: unknown, who: Who = 'companyAdmin') =>
      call(who, 'company', 'PATCH', `/api/companies/${A()}`, { params: { id: A() }, body })

    it('stores dates as calendar days and the share capital in cents', async () => {
      const response = await patch({
        name: 'Atelier Alpha 2',
        foundationDate: '2020-02-29T23:00:00.000Z',
        totalShares: 3,
        shareNominalValue: 0.1,
        legalType: '',
        color: '',
        email: '',
        shareCapital: 999, // read-only, ignored
      })
      expect(response.status).toBe(200)
      const company = await prisma.company.findUniqueOrThrow({ where: { id: A() } })
      expect(company.name).toBe('Atelier Alpha 2')
      expect(company.foundationDate?.toISOString()).toBe('2020-03-01T00:00:00.000Z')
      expect(company.shareCapital?.toString()).toBe('0.3')
      expect(company.legalType).toBeNull()
      expect(company.email).toBeNull()
    })

    it.each([
      [{ siren: '12345' }, /SIREN compte exactement 9 chiffres/],
      [{ legalType: 'LLC' }, /Forme juridique inconnue/],
      [{ foundationDate: 'hier' }, /Date de création invalide/],
      [{ color: 'red' }, /Couleur invalide/],
      [{ totalShares: 'beaucoup' }, /nombre de parts est invalide/],
      [{ shareNominalValue: 'x', totalShares: 10 }, /valeur nominale/],
    ])('refuses %j with a French 400', async (body, message) => {
      const response = await patch(body)
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toMatch(message)
    })

    it('answers 409 in French when the SIREN or the slug belongs to another company', async () => {
      const siren = await patch({ siren: '222 222 222' })
      expect(siren.status).toBe(409)
      expect(await errorOf(siren)).toBe('Une autre société utilise déjà ce SIREN.')
      const slug = await patch({ slug: 'bureau-beta' })
      expect(slug.status).toBe(409)
      expect(await errorOf(slug)).toMatch(/identifiant est déjà utilisé/)
    })

    it('keeps an unchanged slug and refuses a malformed one', async () => {
      expect((await patch({ slug: 'atelier-alpha' })).status).toBe(200)
      expect((await patch({ slug: 'Pas Valide' })).status).toBe(400)
    })

    it('is refused to a viewer (403) and to a member of another company (404)', async () => {
      expect((await patch({ name: 'x' }, 'viewer')).status).toBe(403)
      expect((await patch({ name: 'x' }, 'memberB')).status).toBe(404)
    })
  })

  describe('establishments', () => {
    const create = (body: unknown, who: Who = 'companyAdmin') =>
      call(who, 'establishments', 'POST', `/api/companies/${A()}/establishments`, { params: { id: A() }, body })
    const update = (establishmentId: string, body: unknown, who: Who = 'companyAdmin') =>
      call(who, 'establishment', 'PATCH', `/api/companies/${A()}/establishments/${establishmentId}`, {
        params: { id: A(), establishmentId },
        body,
      })

    it('makes the first establishment the main one and syncs the headquarters address', async () => {
      const response = await create({ siret: '11111111100011', name: 'Siège', addressId: ids.address, companyId: A() })
      expect(response.status).toBe(201)
      const created = (await response.json()) as { isMain: boolean; siren: string; address: { city: string } }
      expect(created).toMatchObject({ isMain: true, siren: '111111111', address: { city: 'Paris' } })
      expect((await prisma.company.findUniqueOrThrow({ where: { id: A() } })).headquartersAddressId).toBe(ids.address)
    })

    it('keeps a single main establishment and hands the role over on delete', async () => {
      const first = (await (await create({ siret: '11111111100011' })).json()) as { id: string }
      const second = (await (await create({ siret: '11111111100029', isMain: true })).json()) as { id: string }
      const mains = await prisma.establishment.findMany({ where: { companyId: A(), isMain: true }, select: { id: true } })
      expect(mains).toEqual([{ id: second.id }])

      const removed = await call('companyAdmin', 'establishment', 'DELETE', `/api/companies/${A()}/establishments/${second.id}`, {
        params: { id: A(), establishmentId: second.id },
      })
      expect(removed.status).toBe(200)
      expect((await prisma.establishment.findUniqueOrThrow({ where: { id: first.id } })).isMain).toBe(true)
      expect((await prisma.establishment.findUniqueOrThrow({ where: { id: second.id } })).isActive).toBe(false)
    })

    it('validates the SIRET and refuses a SIRET already used (409)', async () => {
      const missing = await create({ name: 'x' })
      expect(missing.status).toBe(400)
      expect(await errorOf(missing)).toMatch(/Le SIRET est requis/)
      expect((await create({ siret: '123' })).status).toBe(400)
      expect((await create({ siret: '11111111100011' })).status).toBe(201)
      const duplicate = await create({ siret: '11111111100011' })
      expect(duplicate.status).toBe(409)
      expect(await errorOf(duplicate)).toBe('Un établissement avec ce SIRET existe déjà')
    })

    it('updates fields, keeps the SIRET when sent unchanged and refuses a malformed new one', async () => {
      const created = (await (await create({ siret: '11111111100011' })).json()) as { id: string }
      const response = await update(created.id, {
        siret: '11111111100011',
        name: 'Agence',
        trainingActivityDeclarationDate: '2025-06-30',
      })
      expect(response.status).toBe(200)
      const row = await prisma.establishment.findUniqueOrThrow({ where: { id: created.id } })
      expect(row.name).toBe('Agence')
      expect(row.trainingActivityDeclarationDate?.toISOString()).toBe('2025-06-30T00:00:00.000Z')
      expect((await update(created.id, { siret: '999' })).status).toBe(400)
    })

    it("answers 404 for another company's establishment", async () => {
      const other = await prisma.establishment.create({ data: { companyId: ids.bCompany, siret: '22222222200011', siren: '222222222' } })
      expect((await update(other.id, { name: 'x' })).status).toBe(404)
      const removed = await call('companyAdmin', 'establishment', 'DELETE', `/api/companies/${A()}/establishments/${other.id}`, {
        params: { id: A(), establishmentId: other.id },
      })
      expect(removed.status).toBe(404)
      expect((await prisma.establishment.findUniqueOrThrow({ where: { id: other.id } })).isActive).toBe(true)
    })

    it('creates the main establishment on first read', async () => {
      const response = await call('viewer', 'establishments', 'GET', `/api/companies/${A()}/establishments`, { params: { id: A() } })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([expect.objectContaining({ name: 'Siège social', isMain: true })])
    })
  })

  describe('shareholders', () => {
    const create = (body: unknown, who: Who = 'companyAdmin') =>
      call(who, 'shareholders', 'POST', `/api/companies/${A()}/shareholders`, { params: { id: A() }, body })

    it('creates a natural person shareholder and caps the total at 100 %', async () => {
      const first = await create({ type: 'PHYSICAL', personId: ids.personA, sharePercentage: 66.67, numberOfShares: 200, capitalAmount: '2000,50' })
      expect(first.status).toBe(201)
      expect(await first.json()).toMatchObject({ sharePercentage: '66.67', capitalAmount: '2000.5', numberOfShares: 200 })
      expect((await create({ type: 'LEGAL', name: 'Fonds', sharePercentage: '33.33' })).status).toBe(201)
      const over = await create({ type: 'LEGAL', name: 'Autre', sharePercentage: 0.01 })
      expect(over.status).toBe(400)
      expect(await errorOf(over)).toMatch(/ne peut pas dépasser 100 %/)
    })

    it('refuses a person or a shareholder company the user cannot see', async () => {
      const person = await create({ type: 'PHYSICAL', personId: ids.personB, sharePercentage: 10 })
      expect(person.status).toBe(400)
      expect(await errorOf(person)).toBe("La personne spécifiée n'existe pas")
      const company = await create({ type: 'LEGAL', companyShareholderId: ids.bCompany, sharePercentage: 10 })
      expect(company.status).toBe(400)
      expect(await errorOf(company)).toBe("La société actionnaire spécifiée n'existe pas")
      const self = await create({ type: 'LEGAL', companyShareholderId: A(), sharePercentage: 10 })
      expect(await errorOf(self)).toMatch(/actionnaire d'elle-même/)
    })

    it('requires the type, the percentage and a person for a natural person', async () => {
      expect(await errorOf(await create({ sharePercentage: 10 }))).toMatch(/type d'actionnaire est requis/)
      expect(await errorOf(await create({ type: 'LEGAL', name: 'x' }))).toMatch(/pourcentage de participation est requis/)
      expect(await errorOf(await create({ type: 'PHYSICAL', sharePercentage: 10 }))).toMatch(/sélectionner une personne/)
      expect(await errorOf(await create({ type: 'LEGAL', sharePercentage: 10 }))).toMatch(/nom est requis/)
    })

    it('updates within the cap and deletes only shareholders of the company', async () => {
      const { id } = (await (await create({ type: 'LEGAL', name: 'Fonds', sharePercentage: 40 })).json()) as { id: string }
      await create({ type: 'LEGAL', name: 'Autre', sharePercentage: 60 })
      const params = { id: A(), shareholderId: id }
      const tooMuch = await call('companyAdmin', 'shareholder', 'PATCH', `/api/companies/${A()}/shareholders/${id}`, { params, body: { sharePercentage: 40.01 } })
      expect(tooMuch.status).toBe(400)
      const ok = await call('companyAdmin', 'shareholder', 'PATCH', `/api/companies/${A()}/shareholders/${id}`, { params, body: { sharePercentage: '40', numberOfShares: '12' } })
      expect(ok.status).toBe(200)
      expect(await ok.json()).toMatchObject({ numberOfShares: 12 })

      const other = await prisma.shareholder.create({ data: { companyId: ids.bCompany, type: 'LEGAL', name: 'B', sharePercentage: 10 } })
      const otherParams = { id: A(), shareholderId: other.id }
      expect((await call('companyAdmin', 'shareholder', 'PATCH', '/x', { params: otherParams, body: { notes: 'x' } })).status).toBe(404)
      const deleted = await call('companyAdmin', 'shareholder', 'DELETE', '/x', { params: otherParams })
      expect(deleted.status).toBe(404)
      expect(await errorOf(deleted)).toBe('Actionnaire introuvable')
      expect((await call('companyAdmin', 'shareholder', 'DELETE', '/x', { params })).status).toBe(200)
    })

    it('never exceeds 100 % under concurrent writes', async () => {
      const results = await Promise.all(Array.from({ length: 4 }, (_, i) => create({ type: 'LEGAL', name: `Fonds ${i}`, sharePercentage: 40 })))
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 400, 400])
    })
  })

  describe('tax regimes', () => {
    const path = () => `/api/companies/${A()}/tax-regimes`

    it('closes the open regime the day before the new one, on calendar days', async () => {
      const first = await call('companyAdmin', 'taxRegimes', 'POST', path(), {
        params: { id: A() },
        body: { regimeType: 'vat', regime: 'normal', startDate: '2024-01-01' },
      })
      expect(first.status).toBe(200)
      await call('companyAdmin', 'taxRegimes', 'POST', path(), {
        params: { id: A() },
        // Date picker in Paris: 2025-01-01 at local midnight
        body: { regimeType: 'vat', regime: 'simplified', startDate: '2024-12-31T23:00:00.000Z' },
      })
      const response = await call('viewer', 'taxRegimes', 'GET', `${path()}?regimeType=vat`, { params: { id: A() } })
      const history = (await response.json()) as Array<{ regime: string; startDate: string; endDate: string | null }>
      expect(history.map((h) => [h.regime, h.startDate, h.endDate])).toEqual([
        ['simplified', '2025-01-01T00:00:00.000Z', null],
        ['normal', '2024-01-01T00:00:00.000Z', '2024-12-31T00:00:00.000Z'],
      ])
    })

    it('validates the input and scopes ids by company', async () => {
      const bad = await call('companyAdmin', 'taxRegimes', 'POST', path(), { params: { id: A() }, body: { regimeType: 'iva', regime: 'x', startDate: '2024-01-01' } })
      expect(bad.status).toBe(400)
      expect((await call('viewer', 'taxRegimes', 'GET', `${path()}?regimeType=iva`, { params: { id: A() } })).status).toBe(400)

      const other = await prisma.taxRegimeHistory.create({
        data: { companyId: ids.bCompany, regimeType: 'vat', regime: 'normal', startDate: new Date('2024-01-01T00:00:00Z') },
      })
      expect((await call('companyAdmin', 'taxRegimes', 'PATCH', path(), { params: { id: A() }, body: { id: other.id, regime: 'x' } })).status).toBe(404)
      expect((await call('companyAdmin', 'taxRegimes', 'DELETE', `${path()}?id=${other.id}`, { params: { id: A() } })).status).toBe(404)
      expect((await call('companyAdmin', 'taxRegimes', 'DELETE', path(), { params: { id: A() } })).status).toBe(400)
      expect(await prisma.taxRegimeHistory.count({ where: { id: other.id } })).toBe(1)
    })
  })

  describe('members and users', () => {
    it('lists members with their roles', async () => {
      const response = await call('viewer', 'members', 'GET', `/api/companies/${A()}/members`, { params: { id: A() } })
      expect(response.status).toBe(200)
      const members = (await response.json()) as Array<{ email: string; roles: string[] }>
      expect(members.map((m) => [m.email, m.roles])).toEqual([
        ['cadmin@test.local', ['companyAdmin']],
        ['viewer@test.local', ['viewer']],
      ])
    })

    it('changes a role, refuses an unknown one and scopes member ids by company', async () => {
      const params = { id: A(), memberId: 'm-u-viewer' }
      const ok = await call('admin', 'member', 'PATCH', '/x', { params, body: { role: 'accountant' } })
      expect(await ok.json()).toEqual({ id: 'm-u-viewer', roles: ['accountant'] })
      expect((await call('admin', 'member', 'PATCH', '/x', { params, body: { role: 'owner' } })).status).toBe(400)
      const other = { id: A(), memberId: 'm-u-member-b' }
      expect((await call('admin', 'member', 'PATCH', '/x', { params: other, body: { role: 'viewer' } })).status).toBe(404)
      expect((await call('admin', 'member', 'DELETE', '/x', { params: other })).status).toBe(404)
      expect((await call('admin', 'member', 'DELETE', '/x', { params })).status).toBe(200)
      expect(await prisma.member.count({ where: { id: 'm-u-viewer' } })).toBe(0)
    })

    it('validates the member to add', async () => {
      const response = await call('admin', 'members', 'POST', `/api/companies/${A()}/members`, { params: { id: A() }, body: { email: 'pas-un-email', role: 'viewer' } })
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toMatch(/Email invalide/)
    })

    it('searches users, leaves out the members of a company and clamps the limit', async () => {
      const search = (query: string, who: Who = 'admin') => call(who, 'users', 'GET', `/api/users${query}`)
      const all = (await (await search('?search=TEST.local')).json()) as Array<{ email: string }>
      expect(all).toHaveLength(4)
      const notInA = (await (await search('?excludeCompanyId=atelier-alpha')).json()) as Array<{ email: string }>
      expect(notInA.map((u) => u.email)).toEqual(['admin@test.local', 'b@test.local'])
      expect(await (await search('?limit=1')).json()).toHaveLength(1)
      expect(await (await search('?limit=-5')).json()).toHaveLength(4)
      expect((await search('', 'companyAdmin')).status).toBe(403)
    })

    it('checks the SIREN of a directory lookup', async () => {
      const response = await call('admin', 'lookup', 'GET', '/api/companies/lookup?siren=12')
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toMatch(/9 chiffres/)
    })
  })
})
