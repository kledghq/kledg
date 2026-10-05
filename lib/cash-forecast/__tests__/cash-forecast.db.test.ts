/**
 * Cash forecast against PostgreSQL (session mocked, roles from member rows):
 * - the service on a fixed day: today's bank balance, the open customer and
 *   supplier invoices at their due date, the CFE of the avis, the recurring
 *   payment detected in the bank lines, the budget and the recent pace, each
 *   in its component, and the projection of the saved components;
 * - GET /api/cash-forecast, /alert and /export: read by every member, export
 *   by the roles with reports:export, 404 for another company, 401 anonymous,
 *   400 for an unknown horizon or component;
 * - GET and PUT /api/companies/[id]/cash-forecast-settings: read by every
 *   member, written by company administrators only, validated in French;
 * - the threshold status the dashboard and the simple home ask once displayed
 *   (nothing computed without a threshold, none in the simple home's load).
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cash_forecast')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { CashForecastStatus, CashForecastView } from '../load-cash-forecast.service'
import type { CashForecastSettingsView } from '../cash-forecast-settings.service'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let forecastRoute: Record<'GET', Handler>
let alertRoute: Record<'GET', Handler>
let exportRoute: Record<'GET', Handler>
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
const NOW = new Date('2026-10-05T09:00:00.000Z')

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

/** A validated entry: drafted with its lines, then validated (the triggers refuse lines on a validated entry). */
async function entry(companyId: string, fiscalYearId: string, journalId: string, number: string, date: string, lines: Array<{ accountId: string; debit: number; credit: number; aux?: string; auxLabel?: string }>) {
  const created = await prisma.accountingEntry.create({
    data: { companyId, fiscalYearId, journalId, entryNumber: number, date: day(date), description: `Pièce ${number}`, status: 'draft' },
  })
  await prisma.entryLine.createMany({
    data: lines.map((l) => ({
      accountingEntryId: created.id,
      accountId: l.accountId,
      accountFiscalYearId: fiscalYearId,
      accountingEntryNumber: number,
      debit: l.debit,
      credit: l.credit,
      auxiliaryAccountNumber: l.aux ?? null,
      auxiliaryAccountLabel: l.auxLabel ?? null,
    })),
  })
  await prisma.accountingEntry.update({ where: { id: created.id }, data: { status: 'validated' } })
}

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  }
  const company = await prisma.company.create({ data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111', legalType: 'SAS' } })
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
  const account = async (code: string, label: string) => (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })).id
  const [customers, suppliers, sales, purchases] = [await account('411000', 'Clients'), await account('401000', 'Fournisseurs'), await account('706000', 'Prestations'), await account('607000', 'Achats')]
  const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Opérations diverses' } })
  // A customer invoice of 1 200 € on 20 September (due 20 October, 30 days) and a supplier invoice of 300 € on 1 October (due 31 October).
  await entry(company.id, fy.id, journal.id, '1', '2026-09-20', [
    { accountId: customers, debit: 1200, credit: 0, aux: 'C001', auxLabel: 'Studio Nord' },
    { accountId: sales, debit: 0, credit: 1200 },
  ])
  await entry(company.id, fy.id, journal.id, '2', '2026-10-01', [
    { accountId: purchases, debit: 300, credit: 0 },
    { accountId: suppliers, debit: 0, credit: 300, aux: 'F001', auxLabel: 'Imprimerie Morel' },
  ])
  // The bank reports 10 000 €; a software paid 49,99 € on the 10th of each month and a customer payment in August.
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL' } })
  const bank = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'acc-a', name: 'Compte courant', balance: 10000, currency: 'EUR' } })
  const lines = [
    { day: '2026-07-10', amount: 49.99, side: 'debit', name: 'Logiciel Pro' },
    { day: '2026-08-10', amount: 49.99, side: 'debit', name: 'Logiciel Pro' },
    { day: '2026-08-15', amount: 3000, side: 'credit', name: 'Client Ouest' },
    { day: '2026-09-10', amount: 49.99, side: 'debit', name: 'Logiciel Pro' },
  ]
  for (const [i, l] of lines.entries()) {
    await prisma.bankTransaction.create({
      data: { bankAccountId: bank.id, externalTransactionId: `t${i}`, amount: l.amount, date: day(l.day), side: l.side, label: l.name, counterpartyName: l.name },
    })
  }
  // The CFE avis of 2026: 1 750 €, paid on 15 December; the CFE of 2025 (1 200 €) is not marked paid: late.
  await prisma.localTaxYear.create({ data: { companyId: company.id, year: 2026, cfeTotal: 1750 } })
  await prisma.localTaxYear.create({ data: { companyId: company.id, year: 2025, cfeTotal: 1200 } })
  // A budget: 2 000 € of sales and 500 € of fees in November and December, and a dotation that moves no cash.
  const budget = await prisma.budget.create({ data: { companyId: company.id, fiscalYearId: fy.id } })
  for (const [prefix, label, amount] of [['706', 'Prestations', 2000], ['6226', 'Honoraires', 500], ['681', 'Dotations', 900]] as const) {
    const line = await prisma.budgetLine.create({ data: { budgetId: budget.id, accountPrefix: prefix, label } })
    await prisma.budgetLineAmount.createMany({ data: ['2026-11', '2026-12'].map((month) => ({ lineId: line.id, month, amount })) })
  }
  Object.assign(ids, { company: company.id, other: other.id, fy: fy.id })
}

describe.skipIf(!available)('cash forecast', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cash_forecast')
    ;({ prisma } = await import('@/lib/prisma'))
    forecastRoute = (await import('@/app/api/cash-forecast/route')) as unknown as typeof forecastRoute
    alertRoute = (await import('@/app/api/cash-forecast/alert/route')) as unknown as typeof alertRoute
    exportRoute = (await import('@/app/api/cash-forecast/export/route')) as unknown as typeof exportRoute
    settingsRoute = (await import('@/app/api/companies/[id]/cash-forecast-settings/route')) as unknown as typeof settingsRoute
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('service on a fixed day', () => {
    it('starts from the bank balance and puts every known flow in its component', async () => {
      const { getCashForecast } = await import('../load-cash-forecast.service')
      const view = await getCashForecast(ids.company, {}, NOW)
      expect(view).toMatchObject({ today: '2026-10-05', start: '2026-10-06', end: '2027-04-05', horizonMonths: 6, granularity: 'month' })
      expect(view.opening).toEqual({ cents: 1_000_000, source: 'bank', bankAccounts: 1, otherCurrencies: 0, ledgerCents: 0 })
      const of = (component: string) => view.items.filter((i) => i.component === component).map((i) => ({ day: i.day, label: i.label, cents: i.amountCents }))
      expect(of('receivables')).toEqual([{ day: '2026-10-20', label: 'Studio Nord', cents: 120_000 }])
      expect(of('payables')).toEqual([{ day: '2026-10-31', label: 'Imprimerie Morel', cents: -30_000 }])
      // The late CFE of 2025 counts on the first day, like a late invoice.
      expect(of('taxes')).toEqual([
        { day: '2025-12-15', label: 'Paiement de la CFE 2025', cents: -120_000 },
        { day: '2026-12-15', label: 'Paiement de la CFE 2026', cents: -175_000 },
      ])
      expect(view.items.find((i) => i.label === 'Paiement de la CFE 2025')?.overdue).toBe(true)
      expect(view.projection.periods[0].byComponent.taxes).toBe(-120_000)
      expect(view.unknownTaxes).toEqual([])
      expect(of('recurring').map((i) => [i.day, i.cents])).toEqual(
        ['2026-10-10', '2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10', '2027-03-10'].map((d) => [d, -4_999]),
      )
      // Budget from November on, without the dotation (681); the trend: (-49,99 + 3 000 - 49,99 - 49,99) / 3 months.
      expect(of('budget').map((i) => i.cents)).toEqual([-50_000, 200_000, -50_000, 200_000])
      expect(view.trend).toEqual({ monthlyCents: 95_001, months: ['2026-07', '2026-08', '2026-09'] })
      expect(view.availability.budget).toEqual({ available: true, reason: null })

      // The saved components by default: the known flows, not the budget nor the trend.
      expect(view.projection.components).toEqual(['receivables', 'payables', 'taxes', 'recurring'])
      expect(view.projection.closingCents).toBe(1_000_000 + 120_000 - 30_000 - 120_000 - 175_000 - 6 * 4_999)
      expect(view.projection.firstBelow).toBeNull()
    })

    it('counts the components and the horizon asked for', async () => {
      const { getCashForecast } = await import('../load-cash-forecast.service')
      const view = await getCashForecast(ids.company, { horizon: 3, components: ['budget'], granularity: 'week' }, NOW)
      expect(view.end).toBe('2027-01-05')
      expect(view.projection.components).toEqual(['budget'])
      expect(view.projection.closingCents).toBe(1_000_000 + 2 * 150_000)
      expect(view.projection.periods[0]).toMatchObject({ period: '2026-10-05', start: '2026-10-06', end: '2026-10-11' })
    })

    it('takes the balance of the corporate tax worksheet, and lists the instalments it cannot compute', async () => {
      const { getCashForecast } = await import('../load-cash-forecast.service')
      const { buildCorporateTax } = await import('@/lib/corporate-tax/load-corporate-tax.service')
      await prisma.company.update({ where: { id: ids.company }, data: { corporateTaxRegime: 'simplified' } })
      try {
        const [view, { view: worksheet }] = await Promise.all([getCashForecast(ids.company, { horizon: 12 }, NOW), buildCorporateTax(ids.company, {}, { now: NOW, access: null })])
        // The same figure as the Impôt sur les sociétés page, to the cent.
        expect(worksheet.balance?.balanceCents).toBeGreaterThan(0)
        expect(view.items.filter((i) => i.ruleId === 'is-solde')).toEqual([
          { component: 'taxes', label: "Solde de l'IS de l'exercice clos le 31/12/2026", day: worksheet.balance?.deadline?.date, amountCents: -(worksheet.balance?.balanceCents ?? 0), ruleId: 'is-solde' },
        ])
        // No reference year recorded for the instalments: listed, not counted.
        expect(view.unknownTaxes.map((t) => [t.day, t.ruleId])).toEqual([
          ['2026-12-15', 'is-acompte'],
          ['2027-03-15', 'is-acompte'],
          ['2027-06-15', 'is-acompte'],
        ])
      } finally {
        await prisma.company.update({ where: { id: ids.company }, data: { corporateTaxRegime: null } })
      }
    })
  })

  describe('routes', () => {
    const path = (query = '') => `/api/cash-forecast?companyId=${ids.company}${query}`

    it('lets every member read the forecast of their company, nobody else', async () => {
      for (const who of ['owner', 'accountant', 'viewer'] as const) {
        const response = await call(who, forecastRoute.GET, 'GET', path())
        expect(response.status).toBe(200)
        const view = (await response.json()) as CashForecastView
        expect(view.opening.cents).toBe(1_000_000)
        expect(view.items.some((i) => i.component === 'receivables' && i.label === 'Studio Nord' && i.amountCents === 120_000)).toBe(true)
      }
      expect((await call('outsider', forecastRoute.GET, 'GET', path())).status).toBe(404)
      expect((await call('anonymous', forecastRoute.GET, 'GET', path())).status).toBe(401)
      // Company B sees its own, empty, forecast.
      const own = (await (await call('outsider', forecastRoute.GET, 'GET', `/api/cash-forecast?companyId=${ids.other}`)).json()) as CashForecastView
      expect(own.opening).toMatchObject({ cents: 0, source: 'none' })
      expect(own.items).toEqual([])
    })

    it('refuses an unknown horizon or component with a French message', async () => {
      const horizon = await call('viewer', forecastRoute.GET, 'GET', path('&horizon=4'))
      expect(horizon.status).toBe(400)
      expect((await horizon.json()).error).toContain('L’horizon est de 3, 6 ou 12 mois')
      const component = await call('viewer', forecastRoute.GET, 'GET', path('&components=receivables,salaires'))
      expect(component.status).toBe(400)
      expect((await component.json()).error).toContain('Composante inconnue')
    })

    it('saves the threshold for administrators only, then raises the alert', async () => {
      const settingsPath = `/api/companies/${ids.company}/cash-forecast-settings`
      const body = { thresholdCents: 2_000_000, horizonMonths: 3, components: ['payables', 'receivables'] }
      expect((await call('accountant', settingsRoute.PUT, 'PUT', settingsPath, { id: ids.company }, body)).status).toBe(403)
      expect((await call('viewer', settingsRoute.PUT, 'PUT', settingsPath, { id: ids.company }, body)).status).toBe(403)
      expect((await call('outsider', settingsRoute.PUT, 'PUT', settingsPath, { id: ids.company }, body)).status).toBe(404)
      const invalid = await call('owner', settingsRoute.PUT, 'PUT', settingsPath, { id: ids.company }, { ...body, horizonMonths: 5 })
      expect(invalid.status).toBe(400)

      expect((await (await call('anonymous', alertRoute.GET, 'GET', `/api/cash-forecast/alert?companyId=${ids.company}`)).status)).toBe(401)
      const before = (await (await call('viewer', alertRoute.GET, 'GET', `/api/cash-forecast/alert?companyId=${ids.company}`)).json()) as CashForecastStatus
      expect(before).toEqual({ thresholdCents: null, horizonMonths: 6, alert: null })

      const saved = await call('owner', settingsRoute.PUT, 'PUT', settingsPath, { id: ids.company }, body)
      expect(saved.status).toBe(200)
      expect(((await saved.json()) as CashForecastSettingsView).settings).toEqual({ thresholdCents: 2_000_000, horizonMonths: 3, components: ['receivables', 'payables'] })
      const read = (await (await call('viewer', settingsRoute.GET, 'GET', settingsPath, { id: ids.company })).json()) as CashForecastSettingsView
      expect(read).toEqual({ settings: { thresholdCents: 2_000_000, horizonMonths: 3, components: ['receivables', 'payables'] }, isDefault: false })

      // 10 000 € in the bank under a threshold of 20 000 €: already under, whatever the day.
      const after = (await (await call('viewer', alertRoute.GET, 'GET', `/api/cash-forecast/alert?companyId=${ids.company}`)).json()) as CashForecastStatus
      expect(after).toMatchObject({ thresholdCents: 2_000_000, horizonMonths: 3 })
      expect(after.alert).toMatchObject({ thresholdCents: 2_000_000, horizonMonths: 3, already: true, balanceCents: 1_000_000 })
      expect((await call('outsider', alertRoute.GET, 'GET', `/api/cash-forecast/alert?companyId=${ids.company}`)).status).toBe(404)

      // The simple home never computes the forecast: its card asks this route once displayed (a skeleton until then).
      const { loadSimpleHome } = await import('@/lib/simple/load-simple-home.service')
      const home = await loadSimpleHome(ids.company, { can: () => true, now: NOW })
      expect(home).not.toHaveProperty('cashAlert')
      const { renderToStaticMarkup } = await import('react-dom/server')
      const { createElement } = await import('react')
      const { SimpleHome } = await import('@/components/features/simple/simple-home')
      const { jargonIn } = await import('@/lib/simple/vocabulary')
      const html = renderToStaticMarkup(createElement(SimpleHome, { home, companyName: 'Atelier Lumen', companySlug: 'atelier-lumen', userName: 'Claire Martin' }))
      expect(html).toContain('aria-label="Chargement : Votre argent à venir"')
      expect(jargonIn(html.replace(/<[^>]+>/g, ' '))).toEqual([])
    })

    it('exports the forecast as CSV for the roles that export reports', async () => {
      const exportPath = `/api/cash-forecast/export?companyId=${ids.company}&components=receivables,payables`
      expect((await call('viewer', exportRoute.GET, 'GET', exportPath)).status).toBe(403)
      expect((await call('outsider', exportRoute.GET, 'GET', exportPath)).status).toBe(404)
      const response = await call('accountant', exportRoute.GET, 'GET', exportPath)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
      expect(response.headers.get('content-disposition')).toContain('Prevision_tresorerie_Atelier_Lumen_')
      const csv = await response.text()
      expect(csv).toContain('Prévision de trésorerie Atelier Lumen')
      expect(csv).toContain('sans garantie')
      expect(csv).toContain('Seuil d’alerte : 20000,00')
      expect(csv).toMatch(/Factures clients à encaisser;Studio Nord;1200,00/)
      expect(csv).toMatch(/Factures fournisseurs à payer;Imprimerie Morel;-300,00/)
    })
  })
})
