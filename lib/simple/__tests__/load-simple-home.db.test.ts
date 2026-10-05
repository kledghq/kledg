/**
 * Simple home against PostgreSQL (docs/mode-simple.md): every figure of the
 * home is checked against the report or service the expert screens use
 * (income statement, aged balance, deadlines, missing receipts), so the two
 * modes always agree to the cent. Also: the parts follow the roles, a
 * non-member gets nothing, and the counts route of the simple navigation.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('simple_home')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { jargonIn } from '../vocabulary'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

let prisma: Prisma

const USERS = {
  owner: { id: 'u-owner', email: 'claire@test.local', name: 'Claire Martin', role: 'user' },
  accountant: { id: 'u-accountant', email: 'marc@test.local', name: 'Marc Renaud', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Associé', role: 'user' },
  outsider: { id: 'u-outsider', email: 'b@test.local', name: 'Autre société', role: 'user' },
} as const

const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
/** The home is read on 4 October 2026. */
const NOW = new Date('2026-10-04T09:00:00Z')
const cents = (euros: number) => Math.round(euros * 100)

async function seed() {
  const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  }
  const company = await prisma.company.create({
    data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111', vatRegime: 'normal', corporateTaxRegime: 'simplified' },
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

  const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  const journal = async (code: string, label: string) => (await prisma.journal.create({ data: { companyId: company.id, code, label } })).id
  const journals = { AN: await journal('AN', 'À-nouveaux'), VE: await journal('VE', 'Ventes'), AC: await journal('AC', 'Achats'), OD: await journal('OD', 'Opérations diverses') }

  const CHART: Array<[string, string]> = [
    ['101000', 'Capital'],
    ['401000', 'Fournisseurs'],
    ['411100', 'Studio Nord'],
    ['411200', 'Maison Bleue'],
    ['444000', 'État, impôts sur les bénéfices'],
    ['445660', 'TVA déductible sur autres biens et services'],
    ['445710', 'TVA collectée'],
    ['512000', 'Banque'],
    ['613200', 'Locations immobilières'],
    ['695000', 'Impôts sur les bénéfices'],
    ['706000', 'Prestations de services'],
  ]
  const accounts: Record<string, string> = {}
  for (const [code, label] of CHART) {
    accounts[code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })).id
  }
  type Line = [string, string, string]
  const entry = (journalId: string, date: string, description: string, lines: Line[], status: 'validated' | 'draft' = 'validated') =>
    createEntry({
      companyId: company.id,
      journalId,
      date,
      description,
      status,
      lines: lines.map(([code, debit, credit]) => ({ accountId: accounts[code], debit, credit })),
    })

  await entry(journals.AN, '2026-01-01', 'À-nouveaux', [['512000', '10000.00', '0'], ['101000', '0', '10000.00']])
  await entry(journals.AC, '2026-03-01', 'Loyer mars', [['613200', '800.00', '0'], ['445660', '160.00', '0'], ['401000', '0', '960.00']])
  // Due on 1 July (30 days): overdue on 4 October.
  await entry(journals.VE, '2026-06-01', 'Facture Studio Nord', [['411100', '2400.00', '0'], ['706000', '0', '2000.00'], ['445710', '0', '400.00']])
  // Due on 20 October: not overdue yet.
  await entry(journals.VE, '2026-09-20', 'Facture Maison Bleue', [['411200', '1200.00', '0'], ['706000', '0', '1000.00'], ['445710', '0', '200.00']])
  // Corporate tax booked: the home shows the result before it.
  await entry(journals.OD, '2026-09-30', 'Impôt sur les sociétés', [['695000', '300.00', '0'], ['444000', '0', '300.00']])
  // A draft never counts.
  await entry(journals.VE, '2026-10-01', 'Brouillon', [['411200', '5000.00', '0'], ['706000', '0', '5000.00']], 'draft')

  // Bank: a euro account, a dollar account (not added to euros), one replaced by a direct connection.
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL', secretKeyEncrypted: 'never-returned-secret' } })
  const account = await prisma.bankAccount.create({
    data: { bankConnectionId: connection.id, externalAccountId: 'main', name: 'Compte courant', balance: '12345.67' },
  })
  const dollars = await prisma.bankAccount.create({
    data: { bankConnectionId: connection.id, externalAccountId: 'usd', name: 'Compte USD', balance: '500.00', currency: 'USD' },
  })
  await prisma.bankAccount.create({
    data: { bankConnectionId: connection.id, externalAccountId: 'old', name: 'Ancien', balance: '999.99', supersededById: account.id },
  })
  const tx = (bankAccountId: string, externalTransactionId: string, date: string, amount: string, side: 'debit' | 'credit', reconciled = false) =>
    prisma.bankTransaction.create({ data: { bankAccountId, externalTransactionId, date: day(date), amount, side, label: externalTransactionId, reconciled } })
  await tx(account.id, 'septembre', '2026-09-28', '100.00', 'debit')
  await tx(account.id, 'client', '2026-10-01', '1000.00', 'credit', true)
  await tx(account.id, 'fournitures', '2026-10-02', '250.50', 'debit')
  await tx(account.id, 'frais', '2026-10-03', '40.00', 'debit', true)
  await tx(dollars.id, 'usd', '2026-10-02', '999.00', 'credit')

  // The other company's bank debits never count here.
  const otherConnection = await prisma.bankConnection.create({ data: { companyId: other.id, provider: 'MANUAL' } })
  const otherAccount = await prisma.bankAccount.create({ data: { bankConnectionId: otherConnection.id, externalAccountId: 'b', name: 'B', balance: '1.00' } })
  await tx(otherAccount.id, 'autre', '2026-10-02', '10.00', 'debit')

  Object.assign(ids, { company: company.id, slug: company.slug, other: other.id, fy: fy.id })
}

describe.skipIf(!available)('simple home', () => {
  beforeAll(async () => {
    await prepareTestDatabase('simple_home')
    ;({ prisma } = await import('@/lib/prisma'))
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const load = async (can: (permission: Record<string, readonly string[]>) => boolean = () => true) => {
    const { loadSimpleHome } = await import('../load-simple-home.service')
    return loadSimpleHome(ids.company, { can, now: NOW })
  }

  it('reads the bank balances in euros and the bank lines of the month', async () => {
    const home = await load()
    expect(home.today).toBe('2026-10-04')
    // 12 345,67: the dollar account and the replaced one are left out
    expect(home.bank).toEqual({ balanceCents: 1_234_567, accounts: 1, monthChangeCents: cents(1000 - 250.5 - 40) })
  })

  it('takes the receivables and the customers to chase from the aged balance', async () => {
    const { getAgedBalance } = await import('@/lib/reports/third-parties/get-third-party-reports.service')
    const { overdueCents } = await import('@/lib/reports/third-parties/third-party-balances')
    const report = await getAgedBalance(ids.company, { fiscalYearId: ids.fy, asOf: '2026-10-04' }, NOW)
    const home = await load()
    expect(home.receivables).toEqual({ totalCents: 360_000, overdueCents: 240_000 })
    expect(home.receivables!.totalCents).toBe(report.customers.totals.totalCents)
    expect(home.receivables!.overdueCents).toBe(overdueCents(report.customers.totals))
    expect(home.todo.customersToChase).toEqual([{ label: 'Studio Nord', overdueCents: 240_000, oldestDueDate: '2026-07-01', daysLate: 95 }])
  })

  it('gives the result of the income statement, before the corporate tax', async () => {
    const { generateIncomeStatement } = await import('@/lib/reports/income-statement/generate-income-statement.service')
    const statement = await generateIncomeStatement(ids.company, ids.fy)
    const home = await load()
    // Produits 3 000, charges 800 + 300 of tax: result 1 900, 2 200 before the tax (draft left out)
    expect(home.profit).toEqual({ beforeTaxCents: 220_000, resultCents: 190_000 })
    expect(home.profit!.resultCents).toBe(cents(statement.netResult))
  })

  it('estimates the VAT from the 445 accounts and dates it with the next VAT deadline', async () => {
    const { loadDeadlinesWidget } = await import('@/lib/deadlines/load-deadlines.service')
    const { loadWidgetSource } = await import('@/lib/dashboard/load-widget-data.service')
    const ledger = await loadWidgetSource(ids.company, { source: 'ledger', fiscalYearId: ids.fy }, { can: () => true, now: NOW })
    const { deadlines } = await loadDeadlinesWidget(ids.company, NOW)
    const next = deadlines.find((d) => d.category === 'tva' && d.date >= '2026-10-04')!
    const home = await load()
    // 600 collected, 160 deductible
    expect(home.vat!.estimateCents).toBe(44_000)
    expect(home.vat!.estimateCents).toBe(ledger.summary!.tvaCents)
    expect(next).toBeDefined()
    expect(home.vat!.deadline).toEqual({ date: next.date, label: next.label, estimated: next.estimated })
  })

  it('counts the bank debits and credits to check and the missing receipts as the existing pages do', async () => {
    const { listMissingReceipts, MissingReceiptsQuerySchema } = await import('@/lib/banking/missing-receipts.service')
    const missing = await listMissingReceipts(ids.company, MissingReceiptsQuerySchema.parse({ fiscalYearId: ids.fy }))
    const home = await load()
    // Not reconciled debits of the company: 100,00 and 250,50
    expect(home.todo.expensesToCheck).toBe(2)
    // Not reconciled credits: the 999,00 received on the dollar account
    expect(home.todo.incomeToCheck).toBe(1)
    expect(home.todo.missingReceipts).toBe(missing.count)
    expect(home.todo.missingReceipts).toBeGreaterThan(0)
  })

  it('names the accountant among the members', async () => {
    const home = await load()
    expect(home.accountants).toEqual([{ name: 'Marc Renaud', email: 'marc@test.local' }])
  })

  it('leaves out what the roles may not read', async () => {
    const home = await load((permission) => !('banking' in permission) && !('settings' in permission))
    expect(home.bank).toBeNull()
    expect(home.todo.expensesToCheck).toBeNull()
    expect(home.todo.incomeToCheck).toBeNull()
    expect(home.todo.missingReceipts).toBeNull()
    expect(home.accountants).toBeNull()
    expect(home.profit).not.toBeNull()
    const noReports = await load((permission) => !('reports' in permission))
    expect(noReports.receivables).toBeNull()
    expect(noReports.profit).toBeNull()
    expect(noReports.vat).toBeNull()
    expect(noReports.todo.customersToChase).toBeNull()
  })

  it('opens the page for a member by slug, and nothing for a non-member', async () => {
    const { loadSimpleHomeForUser } = await import('../load-simple-home.service')
    const page = await loadSimpleHomeForUser(USERS.viewer, 'atelier-lumen', NOW)
    expect(page).toMatchObject({ companyName: 'Atelier Lumen', slug: 'atelier-lumen' })
    // A viewer reads the books: every figure is there
    expect(page!.home.bank?.balanceCents).toBe(1_234_567)
    expect(page!.home.profit?.beforeTaxCents).toBe(220_000)
    expect(await loadSimpleHomeForUser(USERS.outsider, 'atelier-lumen', NOW)).toBeNull()
    expect(await loadSimpleHomeForUser(USERS.owner, 'nowhere', NOW)).toBeNull()
  })

  it('renders the home in plain words: no accounting jargon, no account number', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createElement } = await import('react')
    const { SimpleHome } = await import('@/components/features/simple/simple-home')
    const home = await load()
    const html = renderToStaticMarkup(createElement(SimpleHome, { home, companyName: 'Atelier Lumen', companySlug: 'atelier-lumen', userName: 'Claire Martin' }))
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')
    expect(text).toContain('Bonjour Claire')
    expect(text).toContain('Voici où en est Atelier Lumen au 4 octobre 2026.')
    expect(text).toContain('Argent sur vos comptes')
    expect(text).toContain('Bénéfice depuis janvier')
    expect(text).toContain('2 dépenses à vérifier')
    expect(text).toContain('1 recette à identifier')
    expect(html).toContain('href="/atelier-lumen/simple/recettes"')
    expect(text).toContain('Relancer Studio Nord pour')
    expect(jargonIn(text)).toEqual([])
    for (const code of ['411100', '512000', '445710', '706000']) expect(text).not.toContain(code)
  })

  describe('counts route of the simple navigation', () => {
    const call = async (who: keyof typeof USERS | 'anonymous', ref: string) => {
      state.user = who === 'anonymous' ? null : { ...USERS[who] }
      const { GET } = (await import('@/app/api/companies/[id]/simple/counts/route')) as unknown as { GET: Handler }
      return GET(new NextRequest(`http://localhost/api/companies/${ref}/simple/counts`), { params: Promise.resolve({ id: ref }) })
    }

    it('answers the bank debits and credits to check of the company, by slug or id', async () => {
      for (const ref of ['atelier-lumen', ids.company]) {
        const response = await call('viewer', ref)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ expensesToCheck: 2, incomeToCheck: 1 })
      }
    })

    it('answers 404 to a non-member and 401 to an anonymous request', async () => {
      expect((await call('outsider', 'atelier-lumen')).status).toBe(404)
      expect((await call('anonymous', 'atelier-lumen')).status).toBe(401)
    })
  })
})
