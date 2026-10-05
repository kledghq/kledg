/**
 * GET /api/reports/tiers-flows against PostgreSQL, with only the session
 * mocked: what each customer was billed and each supplier billed over the
 * fiscal year (billing entries only: payments, drafts and the opening
 * entry left out, credit notes netted, fixed asset purchases counted), the
 * Tiers record naming its auxiliary account, and company isolation (another
 * company's entries never appear, its fiscal year is a 404, a member of
 * another company gets a 404, a read-only member reads it, anonymous 401).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type User = { id: string; email: string; name: string; role: string }

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('tiers_flows_route')
  return { user: null as User | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { bookLedger, type Ledger } from '@/lib/lettering/__tests__/helpers/ledger'

const available = await testDatabaseAvailable()

const USERS = {
  admin: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' },
  memberB: { id: 'u-member-b', email: 'b@test.local', name: 'Member of B', role: 'user' },
} satisfies Record<string, User>

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let route: { GET: (request: Request) => Promise<Response> }

const get = (query: string) => route.GET(new NextRequest(`http://localhost/api/reports/tiers-flows?${query}`))

describe.skipIf(!available)('GET /api/reports/tiers-flows (PostgreSQL)', () => {
  let a: Ledger
  let b: Ledger

  beforeAll(async () => {
    await prepareTestDatabase('tiers_flows_route')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    route = await import('@/app/api/reports/tiers-flows/route')
  })

  beforeEach(async () => {
    await prepareTestDatabase('tiers_flows_route')
    state.user = USERS.admin
    for (const user of Object.values(USERS)) await prisma.user.create({ data: user })

    a = await bookLedger(prisma, svc, { siren: '940000001', slug: 'flux-alpha' })
    a.accounts['218300'] = (await prisma.account.create({ data: { companyId: a.companyId, fiscalYearId: a.fiscalYearId, code: '218300', label: 'Matériel informatique' } })).id
    await prisma.tiers.create({ data: { companyId: a.companyId, kind: 'CUSTOMER', name: 'Martin et Fils', auxiliaryAccountNumber: 'C001' } })
    // Opening entry: a receivable and a debt brought forward, never billed this year
    await a.entry('AN', '2026-01-01', 'À-nouveaux', [
      { code: '411000', debit: '900.00', aux: ['C001', 'MARTIN'] },
      { code: '401000', credit: '400.00', aux: ['F001', 'Papeterie'] },
      { code: '101300', credit: '500.00' },
    ])
    // Martin: invoice 1 200 TTC, paid, then a credit note of 200
    await a.entry('VE', '2026-02-10', 'Facture 1', [
      { code: '411000', debit: '1200.00', aux: ['C001', 'MARTIN'] },
      { code: '706000', credit: '1000.00' },
      { code: '445710', credit: '200.00' },
    ])
    await a.entry('BQ', '2026-03-10', 'Règlement Martin', [{ code: '512000', debit: '1200.00' }, { code: '411000', credit: '1200.00', aux: ['C001', 'MARTIN'] }])
    await a.entry('VE', '2026-03-15', 'Avoir 1', [{ code: '706000', debit: '200.00' }, { code: '411000', credit: '200.00', aux: ['C001', 'MARTIN'] }])
    // Durand: one invoice of 300, and a draft that never counts
    await a.entry('VE', '2026-04-01', 'Facture 2', [{ code: '411000', debit: '300.00', aux: ['C002', 'Durand'] }, { code: '706000', credit: '300.00' }])
    await a.entry('VE', '2026-04-02', 'Brouillon', [{ code: '411000', debit: '999.00', aux: ['C009', 'Brouillon'] }, { code: '706000', credit: '999.00' }], 'draft')
    // Suppliers: supplies (class 6) paid by bank, a computer (class 2)
    await a.entry('AC', '2026-02-15', 'Fournitures', [{ code: '606100', debit: '80.00' }, { code: '401000', credit: '80.00', aux: ['F001', 'Papeterie'] }])
    await a.entry('BQ', '2026-02-28', 'Règlement Papeterie', [{ code: '401000', debit: '80.00', aux: ['F001', 'Papeterie'] }, { code: '512000', credit: '80.00' }])
    await a.entry('AC', '2026-05-05', 'Ordinateur', [{ code: '218300', debit: '1500.00' }, { code: '401000', credit: '1500.00', aux: ['F002', 'Informatique Pro'] }])

    b = await bookLedger(prisma, svc, { siren: '940000002', slug: 'flux-beta' })
    await b.entry('VE', '2026-02-01', 'Facture B', [{ code: '411000', debit: '5000.00', aux: ['C777', 'Client de Beta'] }, { code: '706000', credit: '5000.00' }])

    await prisma.organization.create({ data: { id: 'org-a', name: 'flux-alpha', slug: 'org-flux-alpha', createdAt: new Date(), companyId: a.companyId } })
    await prisma.organization.create({ data: { id: 'org-b', name: 'flux-beta', slug: 'org-flux-beta', createdAt: new Date(), companyId: b.companyId } })
    await prisma.member.create({ data: { id: 'm-viewer', userId: USERS.viewer.id, organizationId: 'org-a', role: 'viewer', createdAt: new Date() } })
    await prisma.member.create({ data: { id: 'm-member-b', userId: USERS.memberB.id, organizationId: 'org-b', role: 'companyAdmin', createdAt: new Date() } })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('answers the billed amounts of the year per customer and supplier, TTC, credit notes netted', async () => {
    const response = await get(`companyId=${a.companyId}&fiscalYearId=${a.fiscalYearId}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toMatch(/no-store/)
    const report = await response.json()
    expect(report).toMatchObject({ fiscalYear: { id: a.fiscalYearId, year: 2026 }, company: { name: 'flux-alpha' } })
    expect(report.customers.tiers).toEqual([
      { code: 'C001', name: 'Martin et Fils', cents: 100_000, count: 1 },
      { code: 'C002', name: 'Durand', cents: 30_000, count: 1 },
    ])
    expect(report.customers.totalCents).toBe(130_000)
    expect(report.suppliers.tiers).toEqual([
      { code: 'F002', name: 'Informatique Pro', cents: 150_000, count: 1 },
      { code: 'F001', name: 'Papeterie', cents: 8_000, count: 1 },
    ])
    expect(report.suppliers.shown).toEqual(report.suppliers.tiers)
    // The current year without fiscalYearId
    const current = await get(`companyId=${a.companyId}`)
    expect(current.status).toBe(200)
  })

  it('never shows another company: its entries stay out, its fiscal year is a 404', async () => {
    const report = await (await get(`companyId=${a.companyId}&fiscalYearId=${a.fiscalYearId}`)).json()
    expect(JSON.stringify(report)).not.toContain('Client de Beta')
    const crossed = await get(`companyId=${a.companyId}&fiscalYearId=${b.fiscalYearId}`)
    expect(crossed.status).toBe(404)
    expect((await crossed.json()).error).toMatch(/Exercice introuvable/)
    const own = await (await get(`companyId=${b.companyId}&fiscalYearId=${b.fiscalYearId}`)).json()
    expect(own.customers.tiers).toEqual([{ code: 'C777', name: 'Client de Beta', cents: 500_000, count: 1 }])
    expect(own.suppliers).toMatchObject({ totalCents: 0, tiers: [], shown: [] })
  })

  it('lets a read-only member read it, refuses a member of another company (404) and anonymous callers (401)', async () => {
    state.user = USERS.viewer
    expect((await get(`companyId=${a.companyId}&fiscalYearId=${a.fiscalYearId}`)).status).toBe(200)
    expect((await get(`companyId=${b.companyId}&fiscalYearId=${b.fiscalYearId}`)).status).toBe(404)
    state.user = USERS.memberB
    expect((await get(`companyId=${a.companyId}&fiscalYearId=${a.fiscalYearId}`)).status).toBe(404)
    state.user = null
    expect((await get(`companyId=${a.companyId}`)).status).toBe(401)
  })

  it('validates the query', async () => {
    const tooLong = await get(`companyId=${a.companyId}&fiscalYearId=${'x'.repeat(65)}`)
    expect(tooLong.status).toBe(400)
  })
})
