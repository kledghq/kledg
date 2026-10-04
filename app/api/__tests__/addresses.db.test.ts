/**
 * Address routes against PostgreSQL (lib/__tests__/helpers/test-db.ts),
 * through the real route handlers with only the session mocked. Every
 * address belongs to one company (Address.companyId). Checks that:
 * - search and read only see the company's addresses (another company's
 *   address is a 404, like a missing one, even a fresh one linked to nothing);
 * - creating an address never hands out another company's address id and
 *   the new address belongs to the company;
 * - an establishment cannot be attached to another company's address, not
 *   even one just created and not attached yet (no more "unlinked" escape);
 * - replacing or removing an establishment's address deletes the old one in
 *   the same transaction when nothing refers to it any more, and keeps it
 *   while another link uses it;
 * - deleting a company deletes its addresses;
 * - permissions: settings read for reads, settings update for creation;
 * - input is validated with French messages.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('addresses')
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
type Method = 'GET' | 'POST' | 'PATCH'

let prisma: Prisma
const routes: Record<string, Record<string, Handler>> = {}

const ROUTE_MODULES = {
  addresses: () => import('@/app/api/addresses/route'),
  address: () => import('@/app/api/addresses/[id]/route'),
  establishments: () => import('@/app/api/companies/[id]/establishments/route'),
  establishment: () => import('@/app/api/companies/[id]/establishments/[establishmentId]/route'),
}

const USERS = {
  admin: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' },
  companyAdmin: { id: 'u-cadmin', email: 'cadmin@test.local', name: 'Company admin', role: 'user' },
  accountant: { id: 'u-accountant', email: 'accountant@test.local', name: 'Accountant', role: 'user' },
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
const B = () => ids.bCompany
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error
const idsOf = async (response: Response) => ((await response.json()) as Array<{ id: string }>).map((a) => a.id).sort()

const search = (who: Who, companyId: string, term: string, extra = '') =>
  call(who, 'addresses', 'GET', `/api/addresses?companyId=${companyId}&search=${encodeURIComponent(term)}${extra}`)
const read = (who: Who, addressId: string, companyId: string) =>
  call(who, 'address', 'GET', `/api/addresses/${addressId}?companyId=${companyId}`, { params: { id: addressId } })
const create = (who: Who, body: Record<string, unknown>) => call(who, 'addresses', 'POST', '/api/addresses', { body })
const createdId = async (response: Response) => ((await response.json()) as { id: string }).id
const addressExists = async (id: string) => (await prisma.address.count({ where: { id } })) === 1

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
    ['u-accountant', 'org-a', 'accountant'],
    ['u-viewer', 'org-a', 'viewer'],
    ['u-member-b', 'org-b', 'companyAdmin'],
  ]) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }

  // A: an establishment address and a shareholder's address
  const aEstablishmentAddress = await prisma.address.create({ data: { companyId: A(), street: '3 avenue Alpha', postalCode: '75003', city: 'Paris' } })
  const aEstablishment = await prisma.establishment.create({
    data: { companyId: A(), siret: '11111111100011', siren: '111111111', isMain: true, addressId: aEstablishmentAddress.id },
  })
  const aShareholderAddress = await prisma.address.create({ data: { companyId: A(), street: '4 rue Alpha', postalCode: '69001', city: 'Lyon' } })
  const outsider = await prisma.person.create({ data: { firstName: 'Paul', name: 'Petit', addressId: aShareholderAddress.id } })
  await prisma.shareholder.create({ data: { companyId: A(), type: 'PHYSICAL', personId: outsider.id, sharePercentage: 10 } })

  // B: its headquarters at 1 rue de la Paix, an establishment, a member person
  // and an address just created through POST /api/addresses, linked to nothing yet
  const bHeadquarters = await prisma.address.create({ data: { companyId: B(), ...PAIX } })
  await prisma.company.update({ where: { id: B() }, data: { headquartersAddressId: bHeadquarters.id } })
  const bEstablishmentAddress = await prisma.address.create({ data: { companyId: B(), street: '5 avenue Beta', postalCode: '75005', city: 'Paris' } })
  await prisma.establishment.create({
    data: { companyId: B(), siret: '22222222200011', siren: '222222222', isMain: true, addressId: bEstablishmentAddress.id },
  })
  const bPersonAddress = await prisma.address.create({ data: { companyId: B(), street: '6 rue Beta', postalCode: '69002', city: 'Lyon' } })
  await prisma.person.create({ data: { firstName: 'Bruno', name: 'Durand', companyId: B(), addressId: bPersonAddress.id } })
  const bFresh = await prisma.address.create({ data: { companyId: B(), street: '7 rue Libre', postalCode: '75007', city: 'Paris' } })

  Object.assign(ids, {
    aEstablishment: aEstablishment.id,
    aEstablishmentAddress: aEstablishmentAddress.id,
    aShareholderAddress: aShareholderAddress.id,
    outsider: outsider.id,
    bHeadquarters: bHeadquarters.id,
    bEstablishmentAddress: bEstablishmentAddress.id,
    bPersonAddress: bPersonAddress.id,
    bFresh: bFresh.id,
  })
}

describe.skipIf(!available)('address routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('addresses')
    ;({ prisma } = await import('@/lib/prisma'))
    for (const [name, load] of Object.entries(ROUTE_MODULES)) {
      routes[name] = (await load()) as unknown as Record<string, Handler>
    }
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('addresses')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('GET /api/addresses (search)', () => {
    it("finds the company's addresses only (establishments, shareholders), never another company's", async () => {
      const paris = await search('viewer', A(), 'paris')
      expect(paris.status).toBe(200)
      expect(await idsOf(paris)).toEqual([ids.aEstablishmentAddress])

      expect(await idsOf(await search('viewer', A(), 'Lyon'))).toEqual([ids.aShareholderAddress])
      expect(await idsOf(await search('viewer', A(), 'Beta'))).toEqual([])
      expect(await idsOf(await search('viewer', A(), 'Libre'))).toEqual([])
    })

    it('sees every address of company B from B, the one not attached yet included', async () => {
      expect(await idsOf(await search('memberB', B(), 'Paris'))).toEqual(
        [ids.bHeadquarters, ids.bEstablishmentAddress, ids.bFresh].sort(),
      )
      expect(await idsOf(await search('memberB', B(), 'Lyon'))).toEqual([ids.bPersonAddress])
    })

    it("answers 404 on another company's search, for members and by slug", async () => {
      const response = await search('memberB', A(), 'Paris')
      expect(response.status).toBe(404)
      expect((await search('viewer', 'bureau-beta', 'Paris')).status).toBe(404)
    })

    it('returns nothing under 2 characters and clamps the limit', async () => {
      expect(await (await search('viewer', A(), 'P')).json()).toEqual([])
      expect(await idsOf(await search('viewer', A(), 'Paris', '&limit=0'))).toEqual([ids.aEstablishmentAddress])
    })

    it('rejects a limit that is not a number with a French 400', async () => {
      const response = await search('viewer', A(), 'Paris', '&limit=abc')
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toBe('limit: limit doit être un nombre')
    })

    it('requires a session and a company', async () => {
      expect((await search('anonymous', A(), 'Paris')).status).toBe(401)
      const response = await call('viewer', 'addresses', 'GET', '/api/addresses?search=Paris')
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toBe('companyId est requis')
    })
  })

  describe('GET /api/addresses/[id]', () => {
    it('reads an address of the company', async () => {
      const response = await read('viewer', ids.aShareholderAddress, A())
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ id: ids.aShareholderAddress, companyId: A(), street: '4 rue Alpha', postalCode: '69001', city: 'Lyon', country: 'FR' })
    })

    it("answers 404 for another company's address, a fresh one included, and an unknown id", async () => {
      for (const addressId of [ids.bHeadquarters, ids.bEstablishmentAddress, ids.bPersonAddress, ids.bFresh, 'missing']) {
        const response = await read('viewer', addressId, A())
        expect(response.status, addressId).toBe(404)
        expect(await errorOf(response)).toBe('Adresse introuvable')
      }
      expect((await read('memberB', ids.bFresh, B())).status).toBe(200)
    })

    it('answers 404 when the user names a company it is not a member of', async () => {
      expect((await read('viewer', ids.bHeadquarters, B())).status).toBe(404)
      expect((await read('memberB', ids.aEstablishmentAddress, A())).status).toBe(404)
    })

    it("keeps instance administrators to the named company's addresses", async () => {
      expect((await read('admin', ids.bHeadquarters, A())).status).toBe(404)
      expect((await read('admin', ids.bHeadquarters, B())).status).toBe(200)
    })
  })

  describe('POST /api/addresses', () => {
    it("creates an address of the company instead of handing out another company's identical one", async () => {
      const response = await create('companyAdmin', { companyId: A(), ...PAIX })
      expect(response.status).toBe(201)
      const id = await createdId(response)
      expect(id).not.toBe(ids.bHeadquarters)
      expect(await prisma.address.count({ where: { street: PAIX.street } })).toBe(2)
      expect((await prisma.address.findUniqueOrThrow({ where: { id } })).companyId).toBe(A())
    })

    it('reuses an identical address of the company', async () => {
      const response = await create('companyAdmin', { companyId: A(), street: '3 avenue Alpha', postalCode: '75003', city: 'Paris', country: 'fr' })
      expect(response.status).toBe(201)
      expect(await response.json()).toEqual({ id: ids.aEstablishmentAddress })
    })

    it("never reuses another company's address, even one linked to nothing", async () => {
      const response = await create('companyAdmin', { companyId: A(), street: '7 rue Libre', postalCode: '75007', city: 'Paris' })
      const id = await createdId(response)
      expect(id).not.toBe(ids.bFresh)
      expect((await prisma.address.findUniqueOrThrow({ where: { id } })).companyId).toBe(A())
      expect((await prisma.address.findUniqueOrThrow({ where: { id: ids.bFresh } })).companyId).toBe(B())
    })

    it('validates the address with French messages', async () => {
      const response = await create('companyAdmin', { companyId: A(), street: ' ', postalCode: '75001' })
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toBe('street: La rue est requise; city: La ville est requise')
      const country = await create('companyAdmin', { companyId: A(), ...PAIX, country: 'France' })
      expect(await errorOf(country)).toBe('country: Le code pays doit contenir 2 lettres (ISO 3166-1 alpha-2)')
    })

    it('needs the settings update permission and membership', async () => {
      for (const who of ['viewer', 'accountant'] as const) {
        const response = await create(who, { companyId: A(), ...PAIX })
        expect(response.status, who).toBe(403)
        expect(await errorOf(response)).toMatch(/Action non autorisée/)
      }
      expect((await create('memberB', { companyId: A(), ...PAIX })).status).toBe(404)
      expect((await create('anonymous', { companyId: A(), ...PAIX })).status).toBe(401)
      expect(await prisma.address.count({ where: { street: PAIX.street } })).toBe(1)
    })
  })

  describe('establishment address', () => {
    const attach = (addressId: string | null) =>
      call('companyAdmin', 'establishment', 'PATCH', `/api/companies/${A()}/establishments/${ids.aEstablishment}`, {
        params: { id: A(), establishmentId: ids.aEstablishment },
        body: { addressId },
      })
    const addressOfEstablishment = async () =>
      (await prisma.establishment.findUniqueOrThrow({ where: { id: ids.aEstablishment } })).addressId

    it("cannot attach another company's address", async () => {
      const response = await attach(ids.bHeadquarters)
      expect(response.status).toBe(404)
      expect(await errorOf(response)).toBe('Adresse introuvable')
      expect(await addressOfEstablishment()).toBe(ids.aEstablishmentAddress)
    })

    it("cannot attach another company's fresh address, linked to nothing yet", async () => {
      const response = await attach(ids.bFresh)
      expect(response.status).toBe(404)
      expect(await errorOf(response)).toBe('Adresse introuvable')
      expect(await addressOfEstablishment()).toBe(ids.aEstablishmentAddress)

      // Nor when creating an establishment
      const created = await call('companyAdmin', 'establishments', 'POST', `/api/companies/${A()}/establishments`, {
        params: { id: A() },
        body: { siret: '11111111100029', addressId: ids.bFresh },
      })
      expect(created.status).toBe(404)
      expect(await prisma.establishment.count({ where: { siret: '11111111100029' } })).toBe(0)
      expect(await prisma.address.findUniqueOrThrow({ where: { id: ids.bFresh } })).toMatchObject({ companyId: B() })
    })

    it('attaches an address created through POST /api/addresses and deletes the replaced one', async () => {
      const id = await createdId(await create('companyAdmin', { companyId: A(), street: '8 rue Neuve', postalCode: '75008', city: 'Paris' }))
      expect((await attach(id)).status).toBe(200)
      const company = await prisma.company.findUniqueOrThrow({ where: { id: A() } })
      expect(company.headquartersAddressId).toBe(id)
      expect((await read('viewer', id, A())).status).toBe(200)
      expect(await addressExists(ids.aEstablishmentAddress)).toBe(false)
    })

    it('keeps the replaced address while another link still uses it', async () => {
      await prisma.person.update({ where: { id: ids.outsider }, data: { addressId: ids.aEstablishmentAddress } })
      const id = await createdId(await create('companyAdmin', { companyId: A(), street: '9 rue Neuve', postalCode: '75009', city: 'Paris' }))
      expect((await attach(id)).status).toBe(200)
      expect(await addressExists(ids.aEstablishmentAddress)).toBe(true)
      // The shareholder's previous address is not touched by an establishment change
      expect(await addressExists(ids.aShareholderAddress)).toBe(true)
    })

    it('detaching the address clears the headquarters and deletes the unused address', async () => {
      // Attach first, so the main establishment drives the headquarters address
      const id = await createdId(await create('companyAdmin', { companyId: A(), street: '10 rue Neuve', postalCode: '75010', city: 'Paris' }))
      expect((await attach(id)).status).toBe(200)

      expect((await attach(null)).status).toBe(200)
      expect(await addressOfEstablishment()).toBeNull()
      expect((await prisma.company.findUniqueOrThrow({ where: { id: A() } })).headquartersAddressId).toBeNull()
      expect(await addressExists(id)).toBe(false)
    })

    it('deletes the previous headquarters address when a new main establishment replaces it', async () => {
      // B's headquarters (1 rue de la Paix) is only the company's link, not an establishment's
      const id = await createdId(await create('memberB', { companyId: B(), street: '11 rue Neuve', postalCode: '75011', city: 'Paris' }))
      const response = await call('memberB', 'establishments', 'POST', `/api/companies/${B()}/establishments`, {
        params: { id: B() },
        body: { siret: '22222222200037', addressId: id, isMain: true },
      })
      expect(response.status).toBe(201)
      expect((await prisma.company.findUniqueOrThrow({ where: { id: B() } })).headquartersAddressId).toBe(id)
      expect(await addressExists(ids.bHeadquarters)).toBe(false)
      // The former main establishment keeps its address
      expect(await addressExists(ids.bEstablishmentAddress)).toBe(true)
    })
  })

  describe('company deletion', () => {
    it("deletes the company's addresses and leaves the other company's alone", async () => {
      await prisma.company.delete({ where: { id: B() } })
      expect(await prisma.address.count({ where: { companyId: B() } })).toBe(0)
      for (const id of [ids.bHeadquarters, ids.bEstablishmentAddress, ids.bPersonAddress, ids.bFresh]) {
        expect(await addressExists(id), id).toBe(false)
      }
      expect(await prisma.address.count({ where: { companyId: A() } })).toBe(2)
    })
  })
})
