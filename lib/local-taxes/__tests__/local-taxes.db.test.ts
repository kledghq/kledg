/**
 * Local taxes against PostgreSQL (session mocked, roles from member rows;
 * skipped without the server; also run with KLEDG_RLS=enforce). A SAS on
 * 5 October 2026 (clock faked), calendar years, 2026 in progress:
 * - sales 2 700 000 €, purchases 1 500 000 €: value added 1 200 000 €, CVAE
 *   2026 at 0,08 % (BOFiP example rate) = 960 €, then 1 200 € with an
 *   adjustment of 300 000 € (rents of crédit-bail, CGI art. 1586 sexies);
 * - CFE 2025 of 3 500 €, avis 2026 of 4 000 €: acompte of 1 750 € on
 *   15 June (CGI art. 1679 quinquies), balance 2 250 €, the charge on 63511;
 * - idempotent drafts 63511 / 512 and 63511 / 447, dated from the tracker;
 * - a company created in 2026: no CFE, the 1447-C-SD; 2030: no CVAE;
 *   2023: not covered;
 * - routes for every role, exports, the database constraints.
 * Fictitious data.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('local_taxes')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import type { LocalTaxesView } from '../load-local-taxes.service'
import type { CfeEntryResult } from '../prepare-cfe-entry.service'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let routes: {
  view: Record<'GET' | 'PUT', Handler>
  exportFile: Record<'GET', Handler>
  entries: Record<'POST', Handler>
  status: Record<'PUT', Handler>
}

const USERS = {
  owner: { id: 'u-lt-owner', email: 'owner@lt.test', name: 'Présidente', role: 'user' },
  accountant: { id: 'u-lt-accountant', email: 'compta@lt.test', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-lt-viewer', email: 'viewer@lt.test', name: 'Associé', role: 'user' },
  outsider: { id: 'u-lt-outsider', email: 'other@lt.test', name: 'Autre', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const NOW = new Date('2026-10-05T09:00:00Z')
const e = (euros: number) => Math.round(euros * 100)

let books: Books
let created: Books

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

const base = (companyId = books.companyId) => `/api/companies/${companyId}/local-taxes`

async function view(year?: number, who: Who = 'viewer', companyId = books.companyId): Promise<LocalTaxesView> {
  const response = await call(who, routes.view.GET, 'GET', `${base(companyId)}${year ? `?year=${year}` : ''}`, undefined, companyId)
  expect(response.status).toBe(200)
  return (await response.json()) as LocalTaxesView
}

async function prepare(body: Record<string, unknown>, who: Who = 'accountant') {
  const response = await call(who, routes.entries.POST, 'POST', `${base()}/entries`, body)
  return { status: response.status, result: (await response.json()) as CfeEntryResult & { error?: string } }
}

describe.skipIf(!available)('local taxes (PostgreSQL)', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    await prepareTestDatabase('local_taxes')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    routes = {
      view: (await import('@/app/api/companies/[id]/local-taxes/route')) as unknown as typeof routes.view,
      exportFile: (await import('@/app/api/companies/[id]/local-taxes/export/route')) as unknown as typeof routes.exportFile,
      entries: (await import('@/app/api/companies/[id]/local-taxes/entries/route')) as unknown as typeof routes.entries,
      status: (await import('@/app/api/companies/[id]/declarations/status/route')) as unknown as typeof routes.status,
    }

    books = await seedBooks(prisma, svc, { siren: '980000101', slug: 'lt-a' })
    created = await seedBooks(prisma, svc, { siren: '980000102', slug: 'lt-new' })
    await prisma.company.update({ where: { id: books.companyId }, data: { legalType: 'SAS', vatRegime: 'normal', corporateTaxRegime: 'simplified', foundationDate: new Date('2020-01-01T00:00:00Z') } })
    await prisma.company.update({ where: { id: created.companyId }, data: { legalType: 'SAS', vatRegime: 'normal', corporateTaxRegime: 'simplified', foundationDate: new Date('2026-02-01T00:00:00Z') } })
    for (const [who, role] of [['owner', 'companyAdmin'], ['accountant', 'accountant'], ['viewer', 'viewer']] as const) {
      await seedMembership(prisma, USERS[who].id, books.companyId, role)
    }
    await seedMembership(prisma, USERS.owner.id, created.companyId, 'companyAdmin')
    await seedMembership(prisma, USERS.outsider.id, created.companyId, 'companyAdmin')

    // 2026 so far: sales 2 700 000 €, purchases 1 500 000 €
    const accounts = books.accounts
    const sale = await svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.VE,
      date: '2026-03-31',
      description: 'Ventes du trimestre',
      status: 'validated',
      lines: [
        { accountId: accounts['512000'], debit: '2700000.00', credit: '0' },
        { accountId: accounts['706000'], debit: '0', credit: '2700000.00' },
      ],
    })
    expect(sale.id).toBeTruthy()
    await svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.AC,
      date: '2026-04-30',
      description: 'Achats',
      status: 'validated',
      lines: [
        { accountId: accounts['6064'], debit: '1500000.00', credit: '0' },
        { accountId: accounts['512000'], debit: '0', credit: '1500000.00' },
      ],
    })
    // The CFE of 2025, from its avis
    await prisma.localTaxYear.create({ data: { companyId: books.companyId, year: 2025, cfeTotal: 3_500 } })
  }, 120_000)

  afterAll(async () => {
    vi.useRealTimers()
    await prisma?.$disconnect()
  })

  it('computes the CVAE of 2026 from the books at the rate of the year, as an estimate while the year runs', async () => {
    const v = await view(2026)
    expect(v.cvae).toMatchObject({ status: 'in-force', maxRate: '0,28 %', turnoverAnnualCents: e(2_700_000) })
    expect(v.cvae.period?.estimate).toBe(true)
    expect(v.cvae.books).toMatchObject({ turnoverCents: e(2_700_000), sigValueAddedCents: e(1_200_000), valueAddedCents: e(1_200_000) })
    expect(v.cvae.computation).toMatchObject({ declarationRequired: true, taxable: true, rateLabel: '0,08 %', cvaeCents: e(960), totalCents: e(960) })
    // The calendar does not ask for the 1330 nor the 1329-DEF yet: the page says so
    expect(v.cvae.hints.join(' ')).toMatch(/1330-CVAE/)
    expect(v.cvae.hints.join(' ')).toMatch(/1329-DEF/)
    // CVAE of 2025: no turnover in the closed year, no acompte in 2026
    expect(v.cvae.acomptes).toEqual({ due: false, eachCents: null })
    expect(v.sources.some((s) => /2025-127/.test(s.label))).toBe(true)
  })

  it('reads the CFE from the avis, its acompte from the CFE of 2025 (3 000 € or more) and plans the charge', async () => {
    let v = await view(2026)
    expect(v.cfe).toMatchObject({ situation: 'normal', avis: null, previous: { year: 2025, totalCents: e(3_500) } })
    expect(v.cfe.schedule).toEqual({ acompteCents: e(1_750), acompteFrom: 'previous-year', balanceCents: null })
    expect(v.cfe.expected).toMatchObject({ cents: e(3_500), source: 'previous-year', account: { code: '63511' } })
    expect(v.deadlines.map((d) => d.id)).toEqual(expect.arrayContaining(['cfe-acompte:2026', 'cfe:2026']))
    expect(v.deadlines.find((d) => d.id === 'cfe-acompte:2026')?.status.status).toBe('overdue')

    expect((await call('viewer', routes.view.PUT, 'PUT', base(), { year: 2026, cfe: { totalCents: e(4_000) } })).status).toBe(403)
    const saved = await call('accountant', routes.view.PUT, 'PUT', base(), { year: 2026, cfe: { totalCents: e(4_000), noticeOn: '2026-09-20' }, cvaeAdjustments: [{ id: 'cb', label: 'Loyers de crédit-bail', amountCents: e(300_000) }] })
    expect(saved.status).toBe(200)
    v = await view(2026)
    expect(v.cfe.avis).toMatchObject({ totalCents: e(4_000), acompteCents: null, noticeOn: '2026-09-20' })
    expect(v.cfe.schedule).toEqual({ acompteCents: e(1_750), acompteFrom: 'previous-year', balanceCents: e(2_250) })
    expect(v.cfe.expected.months).toEqual([
      { month: '2026-06', cents: e(1_750) },
      { month: '2026-12', cents: e(2_250) },
    ])
    expect(v.cvae.computation).toMatchObject({ valueAdded: { cents: e(1_500_000) }, cvaeCents: e(1_200) })
    // Plafonnement: 1,531 % of 1 500 000 € = 22 965 €, above the CET
    expect(v.plafonnement).toEqual({ rate: 1531, ceilingCents: e(22_965), excessCents: 0 })
  })

  it('refuses inconsistent avis with French messages', async () => {
    const put = (body: unknown) => call('owner', routes.view.PUT, 'PUT', base(), body)
    const tooHigh = await put({ year: 2026, cfe: { totalCents: e(1_000), acompteCents: e(2_000) } })
    expect(tooHigh.status).toBe(400)
    expect(((await tooHigh.json()) as { error: string }).error).toMatch(/acompte ne peut pas dépasser/)
    expect((await put({ year: 2026, cfe: { totalCents: -5 } })).status).toBe(400)
    expect((await put({ year: 1990, cfe: { totalCents: 5 } })).status).toBe(400)
    expect((await put({ year: 2026, cfe: { totalCents: 5, noticeOn: '2027-01-01' } })).status).toBe(400)
  })

  it('prepares the CFE payments as idempotent drafts, dated from the tracker', async () => {
    let { status, result } = await prepare({ year: 2026, kind: 'acompte' })
    expect(status).toBe(201)
    expect(result).toMatchObject({ status: 'created', reference: 'CFE-2026-AC' })
    expect(result.lines).toEqual([
      { code: '63511', label: 'Contribution économique territoriale', debitCents: e(1_750), creditCents: 0 },
      { code: '512000', label: 'Banques', debitCents: 0, creditCents: e(1_750) },
    ])
    const entry = await prisma.accountingEntry.findFirstOrThrow({ where: { companyId: books.companyId, reference: 'CFE-2026-AC' }, select: { status: true, date: true } })
    expect(entry.status).toBe('draft')
    expect(entry.date.toISOString().slice(0, 10)).toBe('2026-06-15')
    ;({ status, result } = await prepare({ year: 2026, kind: 'acompte' }))
    expect([status, result.status]).toEqual([200, 'unchanged'])

    // Paid on 12 June according to the tracker: the draft moves to that day
    expect((await call('accountant', routes.status.PUT, 'PUT', `/api/companies/${books.companyId}/declarations/status`, { deadlineId: 'cfe-acompte:2026', paidOn: '2026-06-12' })).status).toBe(200)
    ;({ status, result } = await prepare({ year: 2026, kind: 'acompte' }))
    expect([status, result.status]).toEqual([201, 'replaced'])
    expect(await prisma.accountingEntry.count({ where: { companyId: books.companyId, reference: 'CFE-2026-AC' } })).toBe(1)

    // The balance as a charge to pay: 63511 / 447
    ;({ status, result } = await prepare({ year: 2026, kind: 'solde', counterpart: 'payable' }))
    expect(status).toBe(201)
    expect(result.lines.map((l) => [l.code, l.debitCents, l.creditCents])).toEqual([
      ['63511', e(2_250), 0],
      ['447', 0, e(2_250)],
    ])
    expect((await prepare({ year: 2026, kind: 'solde' }, 'viewer')).status).toBe(403)
    const v = await view(2026)
    expect(v.cfe.drafts.acompte).toMatchObject({ reference: 'CFE-2026-AC', status: 'draft' })
    expect(v.cfe.drafts.solde).toMatchObject({ reference: 'CFE-2026-SOLDE', status: 'draft' })

    // No avis for 2027: no balance to prepare
    const missing = await prepare({ year: 2027, kind: 'solde' })
    expect(missing.status).toBe(409)
    expect(missing.result.error).toMatch(/avis d’imposition de la CFE 2027/)
  })

  it('has no CFE the year of creation and asks for the 1447-C-SD', async () => {
    const v = await view(2026, 'owner', created.companyId)
    expect(v.cfe.situation).toBe('creation-year')
    expect(v.cfe.expected).toMatchObject({ cents: 0, source: 'creation-year' })
    expect(v.deadlines.find((d) => d.id === 'cfe-1447c:2026')).toMatchObject({ date: '2026-12-31', status: { status: 'todo', kind: 'file' } })
    expect(v.deadlines.find((d) => d.id === 'cfe:2026')).toBeUndefined()
    const response = await call('owner', routes.entries.POST, 'POST', `${base(created.companyId)}/entries`, { year: 2026, kind: 'solde' }, created.companyId)
    expect(response.status).toBe(200)
    expect(((await response.json()) as CfeEntryResult).status).toBe('nothing')
  })

  it('says the CVAE is abolished from 2030 and does not compute years before 2024', async () => {
    const abolished = await view(2030)
    expect(abolished.cvae).toMatchObject({ status: 'abolished', computation: null, maxRate: null })
    expect(abolished.cvae.hints.join(' ')).toMatch(/supprimée à partir de 2030/)
    expect(abolished.plafonnement).toBeNull()
    expect((await view(2023)).cvae).toMatchObject({ status: 'not-covered', computation: null })
  })

  it('reads for every member, 404 outside the company, 401 without a session', async () => {
    expect((await call('outsider', routes.view.GET, 'GET', base())).status).toBe(404)
    expect((await call('anonymous', routes.view.GET, 'GET', base())).status).toBe(401)
    expect((await call('viewer', routes.view.GET, 'GET', `${base()}?year=abc`)).status).toBe(400)
  })

  it('exports the year as CSV and PDF (reports:export)', async () => {
    const csv = await call('accountant', routes.exportFile.GET, 'GET', `${base()}/export?year=2026&format=csv`)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-disposition')).toContain('Impots_locaux_2026_lt_a.csv')
    const bytes = Buffer.from(await csv.arrayBuffer())
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = bytes.toString('utf8')
    expect(text).toContain('Taux effectif;0,08 %')
    expect(text).toContain('Ajustement : Loyers de crédit-bail;300000,00')
    expect(text).toContain('Acompte du 15 juin;1750,00')
    const pdf = await call('owner', routes.exportFile.GET, 'GET', `${base()}/export?year=2026&format=pdf`)
    expect(pdf.status).toBe(200)
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF')
    expect((await call('viewer', routes.exportFile.GET, 'GET', `${base()}/export?format=csv`)).status).toBe(403)
  })

  it('refuses rows the database forbids, whatever the code path', async () => {
    const companyId = books.companyId
    await expect(prisma.localTaxYear.create({ data: { companyId, year: 2031, cfeTotal: 100, cfeAcompte: 200 } })).rejects.toThrow()
    await expect(prisma.localTaxYear.create({ data: { companyId, year: 2031, cfeAcompte: 200 } })).rejects.toThrow()
    await expect(prisma.localTaxYear.create({ data: { companyId, year: 2031, cfeTotal: -1 } })).rejects.toThrow()
    await expect(prisma.localTaxYear.create({ data: { companyId, year: 1999, cfeTotal: 1 } })).rejects.toThrow()
    await expect(prisma.localTaxYear.create({ data: { companyId, year: 2025, cfeTotal: 1 } })).rejects.toThrow()
  })
})
