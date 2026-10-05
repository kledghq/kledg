/**
 * Personal sidebar menus against PostgreSQL (migration
 * 20261118090000_sidebar_preferences, docs/modes-et-menu.md), through the
 * real route with only the session mocked:
 * - a user reads and writes their own menu only, in each company apart;
 * - a non-member gets 404, whatever their own menus;
 * - ids are validated (shape, no other field) and unknown ones ignored, on
 *   write and on read;
 * - showing everything again removes the row;
 * - the company layout loads the user's menus by company id and slug.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('sidebar_preferences')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, queryAsOwner, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

let prisma: Prisma
let route: Record<'GET' | 'PUT', Handler>

const USERS = {
  claire: { id: 'u-claire', email: 'claire@test.local', name: 'Claire', role: 'user' },
  marc: { id: 'u-marc', email: 'marc@test.local', name: 'Marc', role: 'user' },
  outsider: { id: 'u-outsider', email: 'outsider@test.local', name: 'Dehors', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'
const companies = { lumen: '', nova: '' }

function call(who: Who, method: 'GET' | 'PUT', company: string, body?: unknown) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  return route[method](
    new NextRequest(`http://localhost/api/companies/${company}/sidebar-preferences`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    { params: Promise.resolve({ id: company }) },
  )
}
const read = async (who: Who, company: string) => (await (await call(who, 'GET', company)).json()) as { hiddenItems: string[]; hiddenGroups: string[] }
const save = (who: Who, company: string, hiddenItems: unknown, hiddenGroups: unknown = []) => call(who, 'PUT', company, { hiddenItems, hiddenGroups })

describe.skipIf(!available)('sidebar preferences', () => {
  beforeAll(async () => {
    await prepareTestDatabase('sidebar_preferences')
    ;({ prisma } = await import('@/lib/prisma'))
    route = (await import('@/app/api/companies/[id]/sidebar-preferences/route')) as unknown as typeof route
    for (const user of Object.values(USERS)) {
      await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
    }
    for (const [key, name, siren, members] of [
      ['lumen', 'Atelier Lumen', '111111111', [['u-claire', 'viewer'], ['u-marc', 'accountant']]],
      ['nova', 'Nova Conseil', '222222222', [['u-claire', 'companyAdmin']]],
    ] as const) {
      const company = await prisma.company.create({ data: { name, slug: key, siren } })
      companies[key] = company.id
      await prisma.organization.create({ data: { id: `org-${key}`, name, slug: `org-${key}`, createdAt: new Date(), companyId: company.id } })
      for (const [userId, role] of members) {
        await prisma.member.create({ data: { id: `m-${key}-${userId}`, userId, organizationId: `org-${key}`, role, createdAt: new Date() } })
      }
    }
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('reads the whole menu for a user who hid nothing, without writing a row', async () => {
    expect(await read('claire', companies.lumen)).toEqual({ hiddenItems: [], hiddenGroups: [] })
    expect(await prisma.sidebarPreference.count()).toBe(0)
  })

  it('answers 401 to an anonymous request and 404 to a non-member', async () => {
    expect((await call('anonymous', 'GET', companies.lumen)).status).toBe(401)
    expect((await save('anonymous', companies.lumen, ['/journals'])).status).toBe(401)
    expect((await call('outsider', 'GET', companies.lumen)).status).toBe(404)
    expect((await save('outsider', companies.lumen, ['/journals'])).status).toBe(404)
    // Marc is not a member of Nova
    expect((await save('marc', companies.nova, ['/journals'])).status).toBe(404)
    expect(await prisma.sidebarPreference.count()).toBe(0)
  })

  it("saves the user's own menu, a viewer included, by id or by slug", async () => {
    const response = await save('claire', 'lumen', ['/journals', '/budget'], ['saisie'])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ hiddenItems: ['/journals', '/budget'], hiddenGroups: ['saisie'] })
    expect(await read('claire', companies.lumen)).toEqual({ hiddenItems: ['/journals', '/budget'], hiddenGroups: ['saisie'] })
    const row = await prisma.sidebarPreference.findUnique({ where: { userId_companyId: { userId: 'u-claire', companyId: companies.lumen } } })
    expect(row).toMatchObject({ hiddenItems: ['/journals', '/budget'], hiddenGroups: ['saisie'] })
  })

  it('keeps each user and each company apart', async () => {
    // Another member of the same company: their own menu, untouched
    expect(await read('marc', companies.lumen)).toEqual({ hiddenItems: [], hiddenGroups: [] })
    expect((await save('marc', companies.lumen, ['/tiers'])).status).toBe(200)
    expect(await read('claire', companies.lumen)).toEqual({ hiddenItems: ['/journals', '/budget'], hiddenGroups: ['saisie'] })
    // The same user in another company: a menu of its own
    expect(await read('claire', companies.nova)).toEqual({ hiddenItems: [], hiddenGroups: [] })
    expect((await save('claire', companies.nova, [], ['etats'])).status).toBe(200)
    expect(await read('claire', companies.lumen)).toEqual({ hiddenItems: ['/journals', '/budget'], hiddenGroups: ['saisie'] })
    expect(await prisma.sidebarPreference.count()).toBe(3)
  })

  it('validates the ids and refuses any other field', async () => {
    for (const body of [
      { hiddenItems: ['journals'], hiddenGroups: [] },
      { hiddenItems: ['/journals?x=1'], hiddenGroups: [] },
      { hiddenItems: [], hiddenGroups: ['Saisie'] },
      { hiddenItems: [42], hiddenGroups: [] },
      { hiddenItems: [] },
      { hiddenItems: [], hiddenGroups: [], userId: 'u-marc' },
      { hiddenItems: Array.from({ length: 121 }, () => '/journals'), hiddenGroups: [] },
    ]) {
      expect((await call('claire', 'PUT', companies.lumen, body)).status, JSON.stringify(body).slice(0, 60)).toBe(400)
    }
    expect(await read('claire', companies.lumen)).toEqual({ hiddenItems: ['/journals', '/budget'], hiddenGroups: ['saisie'] })
    expect(await read('marc', companies.lumen)).toEqual({ hiddenItems: ['/tiers'], hiddenGroups: [] })
  })

  it('ignores unknown ids, the home and duplicates, on write and on read', async () => {
    const response = await save('marc', companies.lumen, ['/journals', '/page-retiree', '/', '/simple', '/journals'], ['saisie', 'inconnu', 'accueil'])
    expect(await response.json()).toEqual({ hiddenItems: ['/journals'], hiddenGroups: ['saisie'] })
    // A row written by an older version, naming a page removed since
    await queryAsOwner(
      'sidebar_preferences',
      `UPDATE "sidebar_preferences" SET "hiddenItems" = ARRAY['/journals', '/ancienne-page'], "hiddenGroups" = ARRAY['saisie', 'ancien'] WHERE "userId" = 'u-marc'`,
    )
    expect(await read('marc', companies.lumen)).toEqual({ hiddenItems: ['/journals'], hiddenGroups: ['saisie'] })
  })

  it('removes the row when everything is shown again', async () => {
    expect((await save('marc', companies.lumen, [], [])).status).toBe(200)
    expect(await prisma.sidebarPreference.count({ where: { userId: 'u-marc' } })).toBe(0)
    expect(await read('marc', companies.lumen)).toEqual({ hiddenItems: [], hiddenGroups: [] })
  })

  it("loads the user's menus of the switcher's companies by id and slug, never another user's", async () => {
    const { listSidebarPreferences } = await import('../sidebar-preferences.service')
    const switcher = [
      { id: companies.lumen, slug: 'lumen' },
      { id: companies.nova, slug: 'nova' },
    ]
    const claire = await listSidebarPreferences({ id: 'u-claire' }, switcher)
    expect(claire[companies.lumen]).toEqual({ hiddenItems: ['/journals', '/budget'], hiddenGroups: ['saisie'] })
    expect(claire.lumen).toEqual(claire[companies.lumen])
    expect(claire.nova).toEqual({ hiddenItems: [], hiddenGroups: ['etats'] })
    await save('marc', companies.lumen, ['/tiers'])
    expect((await listSidebarPreferences({ id: 'u-marc' }, switcher)).lumen).toEqual({ hiddenItems: ['/tiers'], hiddenGroups: [] })
    expect(await listSidebarPreferences({ id: 'u-outsider' }, switcher)).toEqual({})
    expect(await listSidebarPreferences({ id: 'u-claire' }, [])).toEqual({})
  })

  it('deletes the menus of a deleted user', async () => {
    await queryAsOwner('sidebar_preferences', `DELETE FROM "user" WHERE "id" = 'u-marc'`)
    expect(await prisma.sidebarPreference.count({ where: { userId: 'u-marc' } })).toBe(0)
  })
})
