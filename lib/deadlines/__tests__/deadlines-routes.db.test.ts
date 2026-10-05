/**
 * Deadline routes against PostgreSQL (session mocked, roles from member rows):
 * - GET /api/deadlines lists the deadlines dated within the selected fiscal
 *   year (the current one by default), each with its rule and sources, from
 *   the company's regimes, regime history and settings;
 * - GET and PUT /api/companies/[id]/deadline-settings: read by every
 *   member, written by company administrators only (settings:update),
 *   validated (French message), and taken into account by the calendar;
 * - the dashboard source: the next 60 days and the deadlines missed in the
 *   last 15, from an injected day;
 * - a non-member gets 404, an anonymous request 401.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('deadlines')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { DeadlinesView } from '../load-deadlines.service'
import type { DeadlineSettingsView } from '../deadline-settings.service'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let deadlinesRoute: Record<'GET', Handler>
let settingsRoute: Record<'GET' | 'PUT', Handler>

const USERS = {
  owner: { id: 'u-owner', email: 'owner@test.local', name: 'Gérante', role: 'user' },
  accountant: { id: 'u-accountant', email: 'compta@test.local', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Associé', role: 'user' },
  outsider: { id: 'u-outsider', email: 'b@test.local', name: 'Autre société', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const SETTINGS = {
  vatFilingDay: 21,
  vatCa3Frequency: 'auto',
  vatSimplifiedAcomptes: true,
  isAcomptes: false,
  cfeAcompte: false,
  das2: false,
  cvae: false,
  accountsFiledOnline: true,
}

function call(who: Who, handler: Handler, method: string, path: string, params: Record<string, string> = {}, body?: unknown) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    { params: Promise.resolve(params) },
  )
}

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  }
  const company = await prisma.company.create({
    data: {
      name: 'Atelier Lumen',
      slug: 'atelier-lumen',
      siren: '111111111',
      legalType: 'SAS',
      vatRegime: 'normal',
      corporateTaxRegime: 'simplified',
      foundationDate: day('2020-01-06'),
    },
  })
  const other = await prisma.company.create({ data: { name: 'Bureau Beta', slug: 'bureau-beta', siren: '222222222' } })
  await prisma.organization.create({ data: { id: 'org-a', name: 'A', slug: 'org-a', createdAt: new Date(), companyId: company.id } })
  await prisma.organization.create({ data: { id: 'org-b', name: 'B', slug: 'org-b', createdAt: new Date(), companyId: other.id } })
  const members: Array<[string, string, string]> = [
    ['u-owner', 'org-a', 'companyAdmin'],
    ['u-accountant', 'org-a', 'accountant'],
    ['u-viewer', 'org-a', 'viewer'],
    ['u-outsider', 'org-b', 'companyAdmin'],
  ]
  for (const [userId, organizationId, role] of members) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }
  const fy2025 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  const fy2026 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  const otherFy = await prisma.fiscalYear.create({ data: { companyId: other.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  // The company was at the réel simplifié of VAT until May 2026: the history wins over Company.vatRegime.
  await prisma.taxRegimeHistory.create({ data: { companyId: company.id, regimeType: 'vat', regime: 'simplified', startDate: day('2020-01-06'), endDate: day('2026-05-31') } })
  await prisma.taxRegimeHistory.create({ data: { companyId: company.id, regimeType: 'vat', regime: 'normal', startDate: day('2026-06-01') } })
  Object.assign(ids, { company: company.id, other: other.id, fy2025: fy2025.id, fy2026: fy2026.id, otherFy: otherFy.id })
}

describe.skipIf(!available)('deadline routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('deadlines')
    ;({ prisma } = await import('@/lib/prisma'))
    deadlinesRoute = (await import('@/app/api/deadlines/route')) as unknown as typeof deadlinesRoute
    settingsRoute = (await import('@/app/api/companies/[id]/deadline-settings/route')) as unknown as typeof settingsRoute
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const view = async (who: Who, query: string) => {
    const response = await call(who, deadlinesRoute.GET, 'GET', `/api/deadlines?companyId=${ids.company}${query}`)
    expect(response.status).toBe(200)
    return (await response.json()) as DeadlinesView
  }

  it('lists the deadlines of a fiscal year with their rules and official sources', async () => {
    const data = await view('viewer', `&fiscalYearId=${ids.fy2026}`)
    expect(data.fiscalYear).toMatchObject({ id: ids.fy2026, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' })
    expect(data.deadlines.every((d) => d.date >= '2026-01-01' && d.date <= '2026-12-31')).toBe(true)
    const byId = new Map(data.deadlines.map((d) => [d.id, d]))
    expect(byId.get('liasse:2025-12-31')).toMatchObject({ date: '2026-05-05', form: '2065 et 2033' })
    expect(byId.get('is-solde:2025-12-31')?.date).toBe('2026-05-15')
    expect(byId.get('is-acompte:2026-12-31:1')?.date).toBe('2026-03-16')
    // Réel simplifié until May (CA12 of 2025), réel normal from June: CA3 of June on 19 July (a Sunday), indicative.
    expect(byId.get('tva-ca12:2025')?.date).toBe('2026-05-05')
    expect(byId.get('tva-ca3:2026-06')).toMatchObject({ legalDate: '2026-07-19', date: '2026-07-20', estimated: true })
    expect(byId.has('tva-ca3:2026-05')).toBe(false)
    expect(byId.get('approbation:2025-12-31')?.date).toBe('2026-06-30')
    expect(new Set(data.rules.map((r) => r.id))).toEqual(new Set(data.deadlines.map((d) => d.ruleId)))
    expect(data.rules.every((r) => r.sources.length > 0)).toBe(true)
    expect(data.missingRegimes).toBe(false)
  })

  it('falls back to the current fiscal year for a fiscal year of another company', async () => {
    const data = await view('owner', `&fiscalYearId=${ids.otherFy}`)
    expect(data.fiscalYear?.id).not.toBe(ids.otherFy)
    expect([ids.fy2025, ids.fy2026]).toContain(data.fiscalYear?.id)
  })

  it('reads the settings with the defaults, for every member', async () => {
    for (const who of ['owner', 'accountant', 'viewer'] as const) {
      const response = await call(who, settingsRoute.GET, 'GET', `/api/companies/${ids.company}/deadline-settings`, { id: ids.company })
      expect(response.status, who).toBe(200)
      const body = (await response.json()) as DeadlineSettingsView
      expect(body.isDefault).toBe(true)
      expect(body.settings.vatFilingDay).toBeNull()
    }
  })

  it('lets only administrators save the settings, validated, and the calendar follows them', async () => {
    const path = `/api/companies/${ids.company}/deadline-settings`
    expect((await call('viewer', settingsRoute.PUT, 'PUT', path, { id: ids.company }, SETTINGS)).status).toBe(403)
    expect((await call('accountant', settingsRoute.PUT, 'PUT', path, { id: ids.company }, SETTINGS)).status).toBe(403)

    const invalid = await call('owner', settingsRoute.PUT, 'PUT', path, { id: ids.company }, { ...SETTINGS, vatFilingDay: 30 })
    expect(invalid.status).toBe(400)
    expect(((await invalid.json()) as { error: string }).error).toMatch(/compris entre le 15 et le 24/)

    const saved = await call('owner', settingsRoute.PUT, 'PUT', path, { id: ids.company }, SETTINGS)
    expect(saved.status).toBe(200)
    expect(((await saved.json()) as DeadlineSettingsView)).toEqual({ settings: { ...SETTINGS, cvaeDue: false, cvaeAcomptes: false, cfeChanges: false, periodAutoLock: 'off', periodAutoLockDelayDays: 20 }, isDefault: false })

    const data = await view('viewer', `&fiscalYearId=${ids.fy2026}`)
    const byId = new Map(data.deadlines.map((d) => [d.id, d]))
    expect(byId.get('tva-ca3:2026-06')).toMatchObject({ date: '2026-07-21', estimated: false })
    expect(data.deadlines.filter((d) => d.ruleId === 'is-acompte')).toEqual([])
    expect(byId.get('depot-comptes:2025-12-31')?.date).toBe('2026-08-31')
    expect(data.settings).toEqual({ ...SETTINGS, cvaeDue: false, cvaeAcomptes: false, cfeChanges: false, periodAutoLock: 'off', periodAutoLockDelayDays: 20 })
  })

  it('serves the dashboard source: the next 60 days and the deadlines missed in the last 15', async () => {
    const { loadDeadlinesWidget } = await import('../load-deadlines.service')
    const data = await loadDeadlinesWidget(ids.company, new Date('2026-05-10T09:00:00Z'))
    expect(data).toMatchObject({ today: '2026-05-10', horizonDays: 60, overdueDays: 15, missingRegimes: false })
    // Missed five days ago, VAT before liasse on the same day.
    expect(data.deadlines.slice(0, 2).map((d) => [d.id, d.date])).toEqual([
      ['tva-ca12:2025', '2026-05-05'],
      ['liasse:2025-12-31', '2026-05-05'],
    ])
    expect(data.deadlines.every((d) => d.date >= '2026-04-25' && d.date <= '2026-07-09')).toBe(true)
    expect(data.deadlines.map((d) => d.id)).toContain('approbation:2025-12-31')
  })

  it('reads the turnover of each calendar year from the validated entries (quarterly CA3 threshold from 2027)', async () => {
    const { loadDeadlineContext } = await import('../load-deadlines.service')
    const journal = await prisma.journal.create({ data: { companyId: ids.other, code: 'VE', label: 'Ventes' } })
    const sales = await prisma.account.create({ data: { companyId: ids.other, fiscalYearId: ids.otherFy, code: '706000', label: 'Prestations' } })
    const bank = await prisma.account.create({ data: { companyId: ids.other, fiscalYearId: ids.otherFy, code: '512000', label: 'Banque' } })
    for (const [n, status, amount] of [['1', 'validated', 700_000], ['2', 'validated', 400_000.5], ['3', 'draft', 999]] as const) {
      const entry = await prisma.accountingEntry.create({
        data: {
          companyId: ids.other, journalId: journal.id, fiscalYearId: ids.otherFy, entryNumber: `BR-${n}`, date: day('2026-03-31'),
          lines: { create: [{ accountId: bank.id, accountFiscalYearId: ids.otherFy, debit: amount }, { accountId: sales.id, accountFiscalYearId: ids.otherFy, credit: amount }] },
        },
      })
      if (status === 'validated') await prisma.accountingEntry.update({ where: { id: entry.id }, data: { status, entryNumber: n } })
    }
    const context = await loadDeadlineContext(ids.other)
    expect(context.company.turnoverCentsByYear).toEqual({ 2026: 110_000_050 })
  })

  it('answers 404 to a member of another company and 401 to an anonymous request', async () => {
    expect((await call('outsider', deadlinesRoute.GET, 'GET', `/api/deadlines?companyId=${ids.company}`)).status).toBe(404)
    expect((await call('outsider', settingsRoute.PUT, 'PUT', `/api/companies/${ids.company}/deadline-settings`, { id: ids.company }, SETTINGS)).status).toBe(404)
    expect((await call('anonymous', deadlinesRoute.GET, 'GET', `/api/deadlines?companyId=${ids.company}`)).status).toBe(401)
  })
})
