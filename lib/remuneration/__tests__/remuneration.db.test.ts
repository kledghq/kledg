/**
 * "Rémunération et dividendes" against PostgreSQL (session mocked, roles
 * from member rows; skipped without the server). Fictitious data:
 * - a SAS at the régime simplifié, one natural person holding the whole
 *   capital of 10 000 €, the capital said paid up (15 % rate);
 * - 2026: sales 120 000 €, purchases 20 000 €, the président's pay booked
 *   in 644 for 10 000 €: result before pay 100 000 €;
 * - an SARL whose gérant holds 60 % (TNS), a SCI at the impôt sur le revenu;
 * - the routes for every role: the simulation with its defaults and the
 *   user's changes, saving, replacing, opening and deleting a scenario,
 *   proposing its dividends in the approval of the accounts, the PDF and
 *   CSV exports, another company's scenario, the database constraints.
 * Sources: CGI art. 219; C. com. L232-10, L232-11; CSS L131-6.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('remuneration')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import type { RemunerationView } from '../load-remuneration.service'
import type { SavedScenario } from '../save-remuneration-scenario.service'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let load: typeof import('../load-remuneration.service')
let routes: {
  view: Record<'GET', Handler>
  exportFile: Record<'GET', Handler>
  scenarios: Record<'PUT' | 'DELETE', Handler>
  propose: Record<'POST', Handler>
}

const USERS = {
  owner: { id: 'u-rem-owner', email: 'owner@rem.test', name: 'Présidente', role: 'user' },
  accountant: { id: 'u-rem-accountant', email: 'compta@rem.test', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-rem-viewer', email: 'viewer@rem.test', name: 'Associé', role: 'user' },
  outsider: { id: 'u-rem-outsider', email: 'other@rem.test', name: 'Autre', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const NOW = new Date('2027-01-15T09:00:00Z')
const k = (euros: number) => Math.round(euros * 100)

let books: Books
let sarl: Books
let sci: Books

function call(who: Who, handler: Handler, method: string, path: string, body?: unknown, companyId = books.companyId) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    { params: Promise.resolve({ id: companyId }) },
  )
}

const base = (companyId = books.companyId) => `/api/companies/${companyId}/remuneration`

async function book(target: Books, journal: string, date: string, description: string, lines: Array<[string, number, number]>) {
  await svc.createEntry({
    companyId: target.companyId,
    journalId: target.journals[journal],
    date,
    description,
    status: 'validated',
    lines: lines.map(([code, debit, credit]) => ({ accountId: target.accounts[code], debit: debit.toFixed(2), credit: credit.toFixed(2) })),
  })
}

async function addAccounts(target: Books, list: Array<[string, string]>) {
  for (const [code, label] of list) {
    target.accounts[code] = (await prisma.account.create({ data: { companyId: target.companyId, fiscalYearId: target.fiscalYearId, code, label } })).id
  }
}

const INPUTS = {
  resultBeforePayCents: k(100_000),
  status: 'assimile',
  reducedRate: true,
  reducedRateCeilingCents: k(42_500),
  legalReserveRequired: true,
  capitalCents: k(10_000),
  legalReserveCents: 0,
  priorLossesCents: 0,
  shareBp: 10_000,
  premiumsCents: 0,
  currentAccountCents: 0,
  householdParts: 1,
  otherIncomeCents: 0,
  dividendTaxation: 'best',
  distributionBp: 10_000,
  mixBp: 5_000,
} as const

describe.skipIf(!available)('rémunération et dividendes (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('remuneration')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    load = await import('../load-remuneration.service')
    routes = {
      view: (await import('@/app/api/companies/[id]/remuneration/route')) as unknown as typeof routes.view,
      exportFile: (await import('@/app/api/companies/[id]/remuneration/export/route')) as unknown as typeof routes.exportFile,
      scenarios: (await import('@/app/api/companies/[id]/remuneration/scenarios/route')) as unknown as typeof routes.scenarios,
      propose: (await import('@/app/api/companies/[id]/remuneration/propose-dividends/route')) as unknown as typeof routes.propose,
    }

    books = await seedBooks(prisma, svc, { siren: '970000101', slug: 'rem-sas' })
    sarl = await seedBooks(prisma, svc, { siren: '970000102', slug: 'rem-sarl' })
    sci = await seedBooks(prisma, svc, { siren: '970000103', slug: 'rem-sci' })
    const foundationDate = new Date('2020-01-01T00:00:00Z')
    await prisma.company.update({ where: { id: books.companyId }, data: { name: 'Atelier Remu', legalType: 'SAS', corporateTaxRegime: 'simplified', foundationDate } })
    await prisma.company.update({ where: { id: sarl.companyId }, data: { legalType: 'SARL', corporateTaxRegime: 'simplified', foundationDate } })
    await prisma.company.update({ where: { id: sci.companyId }, data: { legalType: 'SCI', corporateTaxRegime: null, foundationDate } })
    await addAccounts(books, [['101000', 'Capital'], ['644000', 'Rémunération du travail de l’exploitant']])

    const person = await prisma.person.create({ data: { companyId: books.companyId, firstName: 'Claire', name: 'Martin' } })
    await prisma.shareholder.create({ data: { companyId: books.companyId, type: 'PHYSICAL', personId: person.id, sharePercentage: 100 } })
    const gerant = await prisma.person.create({ data: { companyId: sarl.companyId, firstName: 'Paul', name: 'Durand' } })
    await prisma.shareholder.create({ data: { companyId: sarl.companyId, type: 'PHYSICAL', personId: gerant.id, sharePercentage: 60 } })
    await prisma.shareholder.create({ data: { companyId: sarl.companyId, type: 'LEGAL', name: 'Holding', sharePercentage: 40 } })
    await prisma.corporateTaxReturn.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, capitalPaidUp: true } })

    for (const [who, role] of [['owner', 'companyAdmin'], ['accountant', 'accountant'], ['viewer', 'viewer']] as const) {
      await seedMembership(prisma, USERS[who].id, books.companyId, role)
    }
    await seedMembership(prisma, USERS.outsider.id, sci.companyId, 'companyAdmin')
    await seedMembership(prisma, USERS.owner.id, sarl.companyId, 'companyAdmin')
    await seedMembership(prisma, USERS.owner.id, sci.companyId, 'viewer')

    await book(books, 'OD', '2026-01-02', 'Capital', [['512000', 10_000, 0], ['101000', 0, 10_000]])
    await book(books, 'BQ', '2026-03-10', 'Ventes', [['512000', 120_000, 0], ['706000', 0, 120_000]])
    await book(books, 'AC', '2026-04-10', 'Achats', [['6064', 20_000, 0], ['512000', 0, 20_000]])
    await book(books, 'BQ', '2026-06-30', 'Rémunération de la présidente', [['644000', 10_000, 0], ['512000', 0, 10_000]])
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('prefills the simulation from the books and simulates the four scenarios', async () => {
    const view = await load.loadRemuneration(books.companyId, {}, { now: NOW })
    expect(view.status).toBe('ready')
    expect(view.fiscalYear?.year).toBe(2026)
    // The year is over: its result is the default basis; 644 added back
    expect(view.basis).toBe('current')
    const current = view.bases.find((b) => b.basis === 'current')!
    expect(current).toMatchObject({ resultBeforeTaxCents: k(90_000), directorPayBookedCents: k(10_000), resultBeforePayCents: k(100_000) })
    expect(view.bases.find((b) => b.basis === 'closed')).toMatchObject({ resultBeforePayCents: 0 })
    expect(view.defaults).toMatchObject({ resultBeforePayCents: k(100_000), status: 'assimile', reducedRate: true, capitalCents: k(10_000), legalReserveRequired: true, shareBp: 10_000 })
    expect(view.statusReason).toContain('assimilé salarié')
    expect(view.shareholders).toEqual([expect.objectContaining({ name: 'Claire Martin', shareBp: 10_000, natural: true })])
    expect(view.checks.join(' ')).toContain('644 et 646')
    // All dividends: IS 20 750 €, legal reserve 1 000 € (a tenth of the capital), dividends 78 250 €
    const all = view.simulation!.scenarios.allDividends
    expect(all.company).toMatchObject({ corporateTaxCents: k(20_750), legalReserveCents: k(1_000), dividendsCents: k(78_250) })
    expect(view.simulation!.scenarios.optimum.person.netIncomeCents).toBeGreaterThanOrEqual(all.person.netIncomeCents)
    expect(view.sources.map((s) => s.label).join(' ')).toContain('L232-10')
  })

  it('answers the route to every member, with the changes of the user, and 404 to another company', async () => {
    for (const who of ['owner', 'accountant', 'viewer'] as const) {
      const response = await call(who, routes.view.GET, 'GET', `${base()}?basis=current`)
      expect(response.status).toBe(200)
    }
    const changed = await call('viewer', routes.view.GET, 'GET', `${base()}?basis=current&inputs=${encodeURIComponent(JSON.stringify({ shareBp: 5_000, householdParts: 2 }))}`)
    const view = (await changed.json()) as RemunerationView
    expect(view.inputs).toMatchObject({ shareBp: 5_000, householdParts: 2, resultBeforePayCents: k(100_000) })
    expect(view.simulation!.scenarios.allDividends.dividends.receivedCents).toBe(k(39_125))

    const wrong = await call('viewer', routes.view.GET, 'GET', `${base()}?inputs=${encodeURIComponent('{"shareBp": 20000}')}`)
    expect(wrong.status).toBe(400)
    expect((await wrong.json()).error).toContain('Part du capital invalide')
    expect((await call('viewer', routes.view.GET, 'GET', `${base()}?inputs=nope`)).status).toBe(400)
    expect((await call('outsider', routes.view.GET, 'GET', base())).status).toBe(404)
    expect((await call('anonymous', routes.view.GET, 'GET', base())).status).toBe(401)
  })

  it('reads a majority gérant as TNS, and has nothing to simulate for a SCI at the impôt sur le revenu', async () => {
    const view = await load.loadRemuneration(sarl.companyId, {}, { now: NOW })
    expect(view.status).toBe('ready')
    expect(view.defaults).toMatchObject({ status: 'tns', shareBp: 6_000 })
    expect(view.statusReason).toContain('travailleur non salarié')
    expect((await load.loadRemuneration(sci.companyId, {}, { now: NOW })).status).toBe('not-subject')
  })

  it('saves a scenario for closing:execute only, replaces it by name, opens and deletes it', async () => {
    const body = { fiscalYearId: books.fiscalYearId, name: 'Tout en dividendes', inputs: INPUTS, pick: 'allDividends' }
    expect((await call('viewer', routes.scenarios.PUT, 'PUT', `${base()}/scenarios`, body)).status).toBe(403)
    const saved = await call('accountant', routes.scenarios.PUT, 'PUT', `${base()}/scenarios`, body)
    expect(saved.status).toBe(200)
    const scenario = (await saved.json()) as SavedScenario
    expect(scenario).toMatchObject({ name: 'Tout en dividendes', rulesYear: 2026, remunerationCostCents: 0, dividendsCents: k(78_250) })

    const again = await call('owner', routes.scenarios.PUT, 'PUT', `${base()}/scenarios`, { ...body, inputs: { ...INPUTS, distributionBp: 5_000 } })
    expect(((await again.json()) as SavedScenario).id).toBe(scenario.id)
    expect(await prisma.remunerationScenario.count({ where: { companyId: books.companyId } })).toBe(1)

    const opened = (await (await call('viewer', routes.view.GET, 'GET', `${base()}?scenarioId=${scenario.id}`)).json()) as RemunerationView
    expect(opened.scenario?.name).toBe('Tout en dividendes')
    expect(opened.inputs?.distributionBp).toBe(5_000)
    expect(opened.scenarios.map((s) => s.name)).toEqual(['Tout en dividendes'])

    const invalid = await call('owner', routes.scenarios.PUT, 'PUT', `${base()}/scenarios`, { ...body, name: ' ', inputs: { ...INPUTS, householdParts: 0 } })
    expect(invalid.status).toBe(400)
    const elsewhere = await call('owner', routes.scenarios.PUT, 'PUT', `${base()}/scenarios`, { ...body, fiscalYearId: sci.fiscalYearId })
    expect(elsewhere.status).toBe(404)

    expect((await call('viewer', routes.scenarios.DELETE, 'DELETE', `${base()}/scenarios?scenarioId=${scenario.id}`)).status).toBe(403)
    expect((await call('owner', routes.scenarios.DELETE, 'DELETE', `${base()}/scenarios?scenarioId=${scenario.id}`)).status).toBe(204)
    expect((await call('owner', routes.scenarios.DELETE, 'DELETE', `${base()}/scenarios?scenarioId=${scenario.id}`)).status).toBe(404)
  })

  it('proposes the dividends of a scenario in the approval of the accounts, keeping the rest of the approval', async () => {
    await prisma.accountsApproval.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, details: { rcsCity: 'Lyon', allocation: { dividendsCents: 0, otherReservesCents: k(500) } } } })
    const saved = (await (await call('owner', routes.scenarios.PUT, 'PUT', `${base()}/scenarios`, { fiscalYearId: books.fiscalYearId, name: 'Optimum', inputs: INPUTS, pick: 'optimum' })).json()) as SavedScenario
    expect((await call('viewer', routes.propose.POST, 'POST', `${base()}/propose-dividends`, { scenarioId: saved.id })).status).toBe(403)
    const response = await call('accountant', routes.propose.POST, 'POST', `${base()}/propose-dividends`, { scenarioId: saved.id })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ fiscalYearId: books.fiscalYearId, dividendsCents: saved.dividendsCents })
    const approval = await prisma.accountsApproval.findUniqueOrThrow({ where: { fiscalYearId_companyId: { fiscalYearId: books.fiscalYearId, companyId: books.companyId } } })
    expect(approval.details).toMatchObject({ rcsCity: 'Lyon', allocation: { dividendsCents: saved.dividendsCents, otherReservesCents: k(500) } })
    const view = await load.loadRemuneration(books.companyId, {}, { now: NOW })
    expect(view.approval.proposedDividendsCents).toBe(saved.dividendsCents)
    expect((await call('owner', routes.propose.POST, 'POST', `${base()}/propose-dividends`, { scenarioId: 'missing' })).status).toBe(404)
  })

  it('exports the simulation as CSV and PDF with reports:export', async () => {
    const csv = await call('accountant', routes.exportFile.GET, 'GET', `${base()}/export?basis=current&format=csv`)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const text = await csv.text()
    expect(text).toContain('Net pour vous, après impôt')
    expect(text).toContain('Simulation indicative, pas un conseil')
    expect(text).toContain('78250,00')
    const pdf = await call('owner', routes.exportFile.GET, 'GET', `${base()}/export?basis=current`)
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF')
    expect((await call('viewer', routes.exportFile.GET, 'GET', `${base()}/export?format=csv`)).status).toBe(403)
    expect((await call('owner', routes.exportFile.GET, 'GET', `${base(sci.companyId)}/export?format=csv`, undefined, sci.companyId)).status).toBe(403)
  })

  it('refuses a scenario without a name or with negative figures in the database', async () => {
    const data = { companyId: books.companyId, fiscalYearId: books.fiscalYearId, inputs: {}, rulesYear: 2026, remunerationCost: 0, dividends: 0, netIncome: 0 }
    await expect(prisma.remunerationScenario.create({ data: { ...data, name: '  ' } })).rejects.toThrow()
    await expect(prisma.remunerationScenario.create({ data: { ...data, name: 'Négatif', dividends: -1 } })).rejects.toThrow()
    await expect(prisma.remunerationScenario.create({ data: { ...data, name: 'Liste', inputs: [] } })).rejects.toThrow()
    await expect(prisma.remunerationScenario.create({ data: { ...data, name: 'Autre société', fiscalYearId: sci.fiscalYearId } })).rejects.toThrow()
  })
})
