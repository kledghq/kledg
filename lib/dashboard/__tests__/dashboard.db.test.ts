/**
 * Dashboard against PostgreSQL (session mocked, roles from the member rows):
 * - the widget data of a seeded company matches the income statement, the
 *   balance sheet and the account balances to the cent, on the selected
 *   fiscal year, with the previous year over the same span;
 * - layouts are personal: a user reads and writes only their own, a viewer
 *   may save theirs, a non-member gets 404 and an anonymous request 401;
 * - unknown widgets are ignored, the reset brings back the role default.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('dashboard')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let layoutRoute: Record<'GET' | 'PUT' | 'DELETE', Handler>
let widgetsRoute: Record<'GET', Handler>

const USERS = {
  owner: { id: 'u-owner', email: 'owner@test.local', name: 'Gérante', role: 'user' },
  accountant: { id: 'u-accountant', email: 'compta@test.local', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Associé', role: 'user' },
  outsider: { id: 'u-outsider', email: 'b@test.local', name: 'Autre société', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
/** The dashboard is read on 30 June 2026: the comparison stops at 30 June 2025. */
const NOW = new Date('2026-06-30T10:00:00Z')

function call(who: Who, handler: Handler, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    }),
    { params: Promise.resolve({}) },
  )
}

async function seed() {
  const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  }
  const company = await prisma.company.create({ data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111' } })
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

  const journal = async (code: string, label: string) => (await prisma.journal.create({ data: { companyId: company.id, code, label } })).id
  const journals = { AN: await journal('AN', 'À-nouveaux'), VE: await journal('VE', 'Ventes'), AC: await journal('AC', 'Achats'), BQ: await journal('BQ', 'Banque'), OD: await journal('OD', 'Opérations diverses') }

  const CHART: Array<[string, string]> = [
    ['101000', 'Capital'],
    ['401000', 'Fournisseurs'],
    ['411000', 'Clients'],
    ['445660', 'TVA déductible sur autres biens et services'],
    ['445710', 'TVA collectée'],
    ['512000', 'Banque'],
    ['606100', 'Fournitures non stockables'],
    ['607000', 'Achats de marchandises'],
    ['613200', 'Locations immobilières'],
    ['641000', 'Rémunérations du personnel'],
    ['706000', 'Prestations de services'],
    ['707000', 'Ventes de marchandises'],
  ]
  const chart = async (fiscalYearId: string) => {
    const accounts: Record<string, string> = {}
    for (const [code, label] of CHART) {
      accounts[code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId, code, label } })).id
    }
    return accounts
  }
  const a25 = await chart(fy2025.id)
  const a26 = await chart(fy2026.id)

  type Line = [string, string, string]
  const entry = (accounts: Record<string, string>, journalId: string, date: string, description: string, lines: Line[], status: 'validated' | 'draft' = 'validated') =>
    createEntry({
      companyId: company.id,
      journalId,
      date,
      description,
      status,
      lines: lines.map(([code, debit, credit]) => ({ accountId: accounts[code], debit, credit })),
    })

  // 2025: 1 000,00 sold before 30 June, 500,00 after; 100,00 of rent before.
  await entry(a25, journals.VE, '2025-03-10', 'Facture 2025-1', [['411000', '1000.00', '0'], ['706000', '0', '1000.00']])
  await entry(a25, journals.AC, '2025-04-01', 'Loyer avril 2025', [['613200', '100.00', '0'], ['401000', '0', '100.00']])
  await entry(a25, journals.VE, '2025-09-15', 'Facture 2025-2', [['411000', '500.00', '0'], ['706000', '0', '500.00']])

  // 2026
  await entry(a26, journals.AN, '2026-01-01', 'À-nouveaux', [['512000', '10000.00', '0'], ['101000', '0', '10000.00']])
  await entry(a26, journals.VE, '2026-02-10', 'Facture 2026-1', [['411000', '1200.00', '0'], ['706000', '0', '1000.00'], ['445710', '0', '200.00']])
  await entry(a26, journals.VE, '2026-03-05', 'Vente de marchandises', [['411000', '600.00', '0'], ['707000', '0', '500.00'], ['445710', '0', '100.00']])
  await entry(a26, journals.AC, '2026-03-12', 'Achat de marchandises', [['607000', '300.00', '0'], ['445660', '60.00', '0'], ['401000', '0', '360.00']])
  await entry(a26, journals.AC, '2026-04-01', 'Loyer avril', [['613200', '800.00', '0'], ['445660', '160.00', '0'], ['401000', '0', '960.00']])
  await entry(a26, journals.BQ, '2026-04-20', 'Règlement client', [['512000', '1200.00', '0'], ['411000', '0', '1200.00']])
  await entry(a26, journals.BQ, '2026-05-02', 'Règlement fournisseur', [['401000', '360.00', '0'], ['512000', '0', '360.00']])
  await entry(a26, journals.BQ, '2026-05-31', 'Salaire mai', [['641000', '2000.33', '0'], ['512000', '0', '2000.33']])
  await entry(a26, journals.BQ, '2026-06-15', 'Intérêts', [['512000', '0.07', '0'], ['706000', '0', '0.07']])
  // After the reference day: in the year's totals, not in the comparison.
  await entry(a26, journals.VE, '2026-09-01', 'Facture 2026-9', [['411000', '250.00', '0'], ['706000', '0', '250.00']])
  // Drafts: never in the indicators.
  await entry(a26, journals.OD, '2026-06-20', 'Fournitures', [['606100', '45.50', '0'], ['512000', '0', '45.50']], 'draft')
  await entry(a26, journals.OD, '2026-06-21', 'Fournitures 2', [['606100', '12.00', '0'], ['512000', '0', '12.00']], 'draft')

  // Bank: one account, one replaced by a direct connection (not counted), transactions to reconcile.
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL', secretKeyEncrypted: 'never-returned-secret' } })
  const account = await prisma.bankAccount.create({
    data: { bankConnectionId: connection.id, externalAccountId: 'main', name: 'Compte courant', iban: 'FR7612345678901234567890185', balance: '8839.74' },
  })
  await prisma.bankAccount.create({
    data: { bankConnectionId: connection.id, externalAccountId: 'old', name: 'Ancien', balance: '999.99', supersededById: account.id },
  })
  const tx = (externalTransactionId: string, date: string, amount: string, side: 'debit' | 'credit', reconciled = false) =>
    prisma.bankTransaction.create({ data: { bankAccountId: account.id, externalTransactionId, date: day(date), amount, side, label: externalTransactionId, reconciled } })
  await tx('loyer-juin', '2026-06-01', '960.00', 'debit')
  await tx('client-juin', '2026-06-12', '600.00', 'credit')
  await tx('frais', '2026-06-25', '12.40', 'debit')
  await tx('deja-fait', '2026-06-26', '1200.00', 'credit', true)

  for (const [name, usageCount] of [['Loyer', 5], ['Jamais', 0], ['Abonnement', 12]] as const) {
    await prisma.transactionRule.create({ data: { companyId: company.id, name, usageCount } })
  }

  Object.assign(ids, { company: company.id, slug: company.slug, other: other.id, fy2025: fy2025.id, fy2026: fy2026.id, otherFy: otherFy.id })
}

const cents = (euros: number) => Math.round(euros * 100)

describe.skipIf(!available)('dashboard', () => {
  beforeAll(async () => {
    await prepareTestDatabase('dashboard')
    ;({ prisma } = await import('@/lib/prisma'))
    layoutRoute = (await import('@/app/api/dashboard/layout/route')) as unknown as typeof layoutRoute
    widgetsRoute = (await import('@/app/api/dashboard/widgets/route')) as unknown as typeof widgetsRoute
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('widget data', () => {
    const load = async <S extends import('../load-widget-data.service').ServedSource>(source: S, fiscalYearId = ids.fy2026) => {
      const { loadWidgetSource } = await import('../load-widget-data.service')
      return loadWidgetSource(ids.company, { source, fiscalYearId }, { can: () => true, now: NOW })
    }

    it('matches the income statement and the balance sheet to the cent', async () => {
      const { generateIncomeStatement } = await import('@/lib/reports/income-statement/generate-income-statement.service')
      const { generateBalanceSheet } = await import('@/lib/reports/balance-sheet/generate-balance-sheet.service')
      const ledger = await load('ledger')
      const summary = ledger.summary!
      const statement = await generateIncomeStatement(ids.company, ids.fy2026)
      const balanceSheet = await generateBalanceSheet(ids.company, ids.fy2026)

      expect(summary.produitsCents).toBe(175_007)
      expect(summary.chargesCents).toBe(310_033)
      expect(summary.resultatCents).toBe(-135_026)
      expect(summary.produitsCents).toBe(cents(statement.totalProduits))
      expect(summary.chargesCents).toBe(cents(statement.totalCharges))
      expect(summary.resultatCents).toBe(cents(statement.netResult))
      expect(summary.resultatCents).toBe(cents(balanceSheet.netResult ?? NaN))

      // Account balances of the balance sheet lines, by prefix (each account sits on one line).
      type Line = { accounts: Array<{ accountId: string; code: string; debit: number; credit: number }>; children?: Line[] }
      const accounts = new Map<string, { code: string; debit: number; credit: number }>()
      const walk = (lines: Line[]) => lines.forEach((l) => (l.accounts.forEach((a) => accounts.set(a.accountId, a)), walk(l.children ?? [])))
      walk([...balanceSheet.actif.lines, ...balanceSheet.passif.lines] as Line[])
      const sheet = (prefix: string) =>
        [...accounts.values()].filter((a) => a.code.startsWith(prefix)).reduce((s, a) => s + cents(a.debit) - cents(a.credit), 0)
      expect(summary.banqueCents).toBe(883_974)
      expect(summary.banqueCents).toBe(sheet('512'))
      expect(summary.creancesClientsCents).toBe(85_000)
      expect(summary.creancesClientsCents).toBe(sheet('411'))
      expect(summary.dettesFournisseursCents).toBe(96_000)
      expect(summary.dettesFournisseursCents).toBe(-sheet('401'))
      expect(summary.tvaCents).toBe(8_000)
      expect(summary.tvaCents).toBe(-sheet('445'))
    })

    it("keeps the chiffre d'affaires, the marge and the charges by post apart", async () => {
      const { summary } = await load('ledger')
      expect(summary!.chiffreAffairesCents).toBe(175_007)
      expect(summary!.marge).toEqual({ ventesCents: 50_000, coutCents: 30_000, margeCents: 20_000 })
      expect(summary!.chargesParPoste.slice(0, 3).map((p) => [p.code, p.cents])).toEqual([
        ['64', 200_033],
        ['61', 80_000],
        ['60', 30_000],
      ])
      expect(summary!.autresChargesCents).toBe(0)
    })

    it('compares with the previous fiscal year over the same span', async () => {
      const { previous } = await load('ledger')
      expect(previous).toEqual({
        year: 2025,
        startDate: '2025-01-01',
        endDate: '2025-06-30',
        produitsCents: 100_000,
        chargesCents: 10_000,
        resultatCents: 90_000,
        chiffreAffairesCents: 100_000,
      })
      // The previous year itself has no year before it.
      expect((await load('ledger', ids.fy2025)).previous).toBeNull()
    })

    it('reads the bank balances, without the account replaced by a direct connection', async () => {
      const { bank } = await load('ledger')
      expect(bank).toEqual({ balanceCents: 883_974, accounts: 1, otherCurrencies: 0 })
    })

    it('draws the 512 balance month by month, ending on the balance of the year', async () => {
      const treasury = await load('treasury')
      expect(treasury.openingCents).toBe(1_000_000)
      const byMonth = Object.fromEntries(treasury.points!.map((p) => [p.month, p.balanceCents]))
      expect(byMonth['2026-01']).toBe(1_000_000)
      expect(byMonth['2026-04']).toBe(1_120_000)
      expect(byMonth['2026-05']).toBe(1_120_000 - 36_000 - 200_033)
      expect(treasury.points!.at(-1)!.balanceCents).toBe(883_974)
    })

    it('sums produits and charges per month like the statements', async () => {
      const { months } = await load('monthly')
      const total = months!.reduce((s, m) => s + cents(m.revenue), 0)
      // Months up to today: the September invoice is after the window when the year is in progress.
      expect(total).toBeGreaterThanOrEqual(150_007)
      expect(cents(months![1].revenue)).toBe(100_000)
      expect(cents(months![4].expenses)).toBe(200_033)
    })

    it('lists the transactions to reconcile, most recent first, signed', async () => {
      const data = await load('reconciliation')
      expect(data.count).toBe(3)
      expect(data.recent.map((t) => [t.label, t.amountCents])).toEqual([
        ['frais', -1_240],
        ['client-juin', 60_000],
        ['loyer-juin', -96_000],
      ])
    })

    it('counts the drafts of the fiscal year and totals each entry in one grouped query', async () => {
      const drafts = await load('drafts')
      expect(drafts.count).toBe(2)
      expect(drafts.entries!.map((e) => [e.description, e.totalCents, e.status])).toEqual([
        ['Fournitures 2', 1_200, 'draft'],
        ['Fournitures', 4_550, 'draft'],
      ])
      const recent = await load('recent-entries')
      expect(recent.count).toBe(12)
      expect(recent.entries).toHaveLength(5)
      expect(recent.entries![0]).toMatchObject({ description: 'Facture 2026-9', journalCode: 'VE', totalCents: 25_000 })
    })

    it('lists bank accounts without credentials and the rules that served most', async () => {
      const banks = await load('bank-accounts')
      expect(banks.accounts.map((a) => [a.name, a.balanceCents])).toEqual([['Compte courant', 883_974]])
      expect(JSON.stringify(banks)).not.toMatch(/secret/i)
      const rules = await load('rules')
      expect(rules.total).toBe(3)
      expect(rules.rules.map((r) => [r.name, r.usageCount])).toEqual([
        ['Abonnement', 12],
        ['Loyer', 5],
      ])
    })

    it('sums the overdue receivables and payables of the aged balance on the reference day', async () => {
      const aged = await load('aged-balance')
      // 411: 1 200,00 (110 days late) + 600,00 (87 days) - the payment of 1 200,00; 401: 960,00 (60 days)
      expect(aged).toMatchObject({
        asOf: '2026-06-30',
        terms: { days: 30, endOfMonth: false },
        customers: { overdueCents: 60_000, totalCents: 60_000, overdueTiers: 1 },
        suppliers: { overdueCents: 96_000, totalCents: 96_000, overdueTiers: 1 },
      })
      expect(aged.top).toEqual([
        { kind: 'suppliers', code: '401000', label: 'Fournisseurs', overdueCents: 96_000, oldestDueDate: '2026-04-11' },
        { kind: 'customers', code: '411000', label: 'Clients', overdueCents: 60_000, oldestDueDate: '2026-03-12' },
      ])
    })
  })

  describe('GET /api/dashboard/widgets', () => {
    const path = (source: string, extra = '') => `/api/dashboard/widgets?companyId=${ids.company}&source=${source}${extra}`

    it('serves every member, viewers included', async () => {
      for (const who of ['owner', 'accountant', 'viewer'] as const) {
        const response = await call(who, widgetsRoute.GET, 'GET', path('ledger', `&fiscalYearId=${ids.fy2026}`))
        expect(response.status, who).toBe(200)
        expect(((await response.json()) as { fiscalYear: { id: string } }).fiscalYear.id).toBe(ids.fy2026)
      }
    })

    it('reads by slug, and never another company’s fiscal year', async () => {
      const response = await call('viewer', widgetsRoute.GET, 'GET', `/api/dashboard/widgets?companyId=${ids.slug}&source=drafts&fiscalYearId=${ids.otherFy}`)
      expect(response.status).toBe(200)
      const body = (await response.json()) as { fiscalYear: { id: string } }
      expect([ids.fy2025, ids.fy2026]).toContain(body.fiscalYear.id)
    })

    it('answers 404 to a non-member, 401 when signed out, 400 for an unknown source', async () => {
      expect((await call('outsider', widgetsRoute.GET, 'GET', path('ledger'))).status).toBe(404)
      expect((await call('anonymous', widgetsRoute.GET, 'GET', path('ledger'))).status).toBe(401)
      const unknown = await call('owner', widgetsRoute.GET, 'GET', path('secrets'))
      expect(unknown.status).toBe(400)
      expect(((await unknown.json()) as { error: string }).error).toMatch(/Source de widget inconnue/)
    })
  })

  describe('/api/dashboard/layout', () => {
    const path = () => `/api/dashboard/layout?companyId=${ids.company}`
    type View = { items: Array<{ id: string; size: string }>; isDefault: boolean; profile: string }
    const read = async (who: Who) => {
      const response = await call(who, layoutRoute.GET, 'GET', path())
      expect(response.status).toBe(200)
      return (await response.json()) as View
    }

    it('gives each role its default layout until a layout is saved', async () => {
      const owner = await read('owner')
      expect(owner).toMatchObject({ isDefault: true, profile: 'owner' })
      expect(owner.items.slice(0, 5).map((i) => i.id)).toEqual(['guide-demarrer', 'kpi-chiffre-affaires', 'kpi-resultat', 'kpi-tresorerie', 'kpi-a-rapprocher'])
      expect((await read('accountant')).items.slice(1, 4).map((i) => i.id)).toEqual(['list-brouillons', 'list-a-rapprocher', 'kpi-tva'])
      const viewer = await read('viewer')
      expect(viewer.profile).toBe('viewer')
      expect(viewer.items.map((i) => i.id)).not.toContain('guide-demarrer')
    })

    it('lets a viewer save their own layout; unknown and forbidden widgets are ignored', async () => {
      const response = await call('viewer', layoutRoute.PUT, 'PUT', path(), {
        items: [
          { id: 'kpi-resultat', size: 'M' },
          { id: 'widget-de-demain', size: 'S' },
          { id: 'guide-demarrer', size: 'L' },
          { id: 'chart-tresorerie' },
        ],
      })
      expect(response.status).toBe(200)
      const expected = [
        { id: 'kpi-resultat', size: 'M' },
        { id: 'chart-tresorerie', size: 'M' },
      ]
      expect(((await response.json()) as View).items).toEqual(expected)
      expect(await read('viewer')).toEqual({ items: expected, isDefault: false, profile: 'viewer' })
    })

    it("never shows a user another member's layout", async () => {
      await call('owner', layoutRoute.PUT, 'PUT', path(), { items: [{ id: 'kpi-tva', size: 'S' }] })
      expect((await read('owner')).items).toEqual([{ id: 'kpi-tva', size: 'S' }])
      expect((await read('viewer')).items.map((i) => i.id)).toEqual(['kpi-resultat', 'chart-tresorerie'])
      expect((await read('accountant')).isDefault).toBe(true)
      const rows = await prisma.dashboardLayout.findMany({ where: { companyId: ids.company }, select: { userId: true } })
      expect(rows.map((r) => r.userId).sort()).toEqual(['u-owner', 'u-viewer'])
    })

    it('resets to the default of the role by removing the saved layout', async () => {
      const response = await call('viewer', layoutRoute.DELETE, 'DELETE', path())
      expect(response.status).toBe(200)
      expect(((await response.json()) as View).isDefault).toBe(true)
      expect((await read('viewer')).isDefault).toBe(true)
      expect(await prisma.dashboardLayout.count({ where: { userId: 'u-viewer' } })).toBe(0)
      // The owner's layout is untouched.
      expect((await read('owner')).items).toEqual([{ id: 'kpi-tva', size: 'S' }])
    })

    it('falls back to the default when a stored row cannot be read', async () => {
      await prisma.dashboardLayout.update({ where: { userId_companyId: { userId: 'u-owner', companyId: ids.company } }, data: { layout: { version: 42 } } })
      expect((await read('owner')).isDefault).toBe(true)
    })

    it('refuses an unknown size with a French message', async () => {
      const response = await call('owner', layoutRoute.PUT, 'PUT', path(), { items: [{ id: 'kpi-tva', size: 'XL' }] })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/Taille de widget inconnue/)
    })

    it('answers 404 to a non-member and 401 when signed out, on every method', async () => {
      for (const [method, handler, body] of [
        ['GET', layoutRoute.GET, undefined],
        ['PUT', layoutRoute.PUT, { items: [] }],
        ['DELETE', layoutRoute.DELETE, undefined],
      ] as const) {
        expect((await call('outsider', handler, method, path(), body)).status, method).toBe(404)
        expect((await call('anonymous', handler, method, path(), body)).status, method).toBe(401)
      }
      expect(await prisma.dashboardLayout.count({ where: { userId: 'u-outsider' } })).toBe(0)
    })

    it('refuses a cross-site write', async () => {
      const response = await call('owner', layoutRoute.PUT, 'PUT', path(), { items: [] }, { 'sec-fetch-site': 'cross-site', cookie: 'session=1' })
      expect(response.status).toBe(403)
    })
  })
})
