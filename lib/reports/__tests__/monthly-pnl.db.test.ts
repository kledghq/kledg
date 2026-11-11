/**
 * Monthly profit and loss (get_monthly_pnl) against PostgreSQL: produits
 * (class 7, credit minus debit) and charges (class 6, debit minus credit) of
 * PCG art. 821-1, chiffre d'affaires (accounts 70, rebates 709 deducted,
 * cerfa 2052 line FL), result, per calendar month across two fiscal years,
 * from validated entries only: drafts, closing entries and another company's
 * books left out, months without entries at zero, first and last days of a
 * month in that month. The Node process runs in America/Los_Angeles: calendar
 * days must not move with the server timezone. Skipped without the test
 * database server.
 *
 * Ledger (euros):
 *   VE  31/12/2025  411 D 1 200    | 706 C 1 000    | 44571 C 200
 *   VE  01/01/2026  411 D 600,60   | 707 C 500,50   | 44571 C 100,10
 *   BQ  15/01/2026  512 D 80       | 764 C 80         (produit financier, not turnover)
 *   OD  20/01/2026  709 D 50       | 411 C 50         (rabais accordé)
 *   AC  31/01/2026  6064 D 300,25  | 44566 D 60,05  | 401 C 360,30
 *   BQ  31/01/2026  661 D 10       | 512 C 10
 *   CL  31/01/2026  706 D 100      | 120 C 100        (reference CL-: closing, left out)
 *   VE  10/02/2026  411 D 999      | 706 C 999        (draft until validated)
 *   VE  01/03/2026  411 D 120      | 706 C 100      | 44571 C 20
 *   another company: VE 10/01/2026 411 D 777 | 706 C 777
 * December 2025: produits 1 000, CA 1 000, result 1 000.
 * January 2026: produits 500,50 + 80 - 50 = 530,50, CA 500,50 - 50 = 450,50,
 * charges 300,25 + 10 = 310,25, result 220,25.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  process.env.TZ = 'America/Los_Angeles'
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('monthly_pnl')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let pnl: typeof import('../get-monthly-pnl.service')

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ids = { company: '', draft: '' }

async function seedCompany(slug: string, siren: string) {
  const company = await prisma.company.create({ data: { name: slug, slug, siren } })
  const years = {
    2025: await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } }),
    2026: await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } }),
  }
  const journals: Record<string, string> = {}
  for (const [code, label] of [['VE', 'Ventes'], ['AC', 'Achats'], ['BQ', 'Banque'], ['OD', 'Opérations diverses'], ['CL', 'Journal de clôture']]) {
    journals[code] = (await prisma.journal.create({ data: { companyId: company.id, code, label } })).id
  }
  const accounts: Record<number, Record<string, string>> = { 2025: {}, 2026: {} }
  const codes = ['120000', '401000', '411000', '445660', '445710', '512000', '6064', '661000', '706000', '707000', '709000', '764000']
  for (const year of [2025, 2026] as const) {
    for (const code of codes) {
      accounts[year][code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: years[year].id, code, label: `Compte ${code}` } })).id
    }
  }
  const entry = async (journal: string, date: string, lines: Array<[string, string, string]>, options: { status?: 'draft' | 'validated'; reference?: string } = {}) => {
    const year = Number(date.slice(0, 4))
    const created = await svc.createEntry({
      companyId: company.id,
      journalId: journals[journal],
      date,
      description: `${journal} ${date}`,
      reference: options.reference,
      status: options.status ?? 'validated',
      lines: lines.map(([code, debit, credit]) => ({ accountId: accounts[year][code], debit, credit })),
    })
    return created.id
  }
  return { company, entry }
}

describe.skipIf(!available)('monthly profit and loss (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('monthly_pnl')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    pnl = await import('../get-monthly-pnl.service')

    const { company, entry } = await seedCompany('pnl-alpha', '900000201')
    await entry('VE', '2025-12-31', [['411000', '1200', '0'], ['706000', '0', '1000'], ['445710', '0', '200']])
    await entry('VE', '2026-01-01', [['411000', '600.60', '0'], ['707000', '0', '500.50'], ['445710', '0', '100.10']])
    await entry('BQ', '2026-01-15', [['512000', '80', '0'], ['764000', '0', '80']])
    await entry('OD', '2026-01-20', [['709000', '50', '0'], ['411000', '0', '50']])
    await entry('AC', '2026-01-31', [['6064', '300.25', '0'], ['445660', '60.05', '0'], ['401000', '0', '360.30']])
    await entry('BQ', '2026-01-31', [['661000', '10', '0'], ['512000', '0', '10']])
    await entry('CL', '2026-01-31', [['706000', '100', '0'], ['120000', '0', '100']], { reference: 'CL-2026' })
    ids.draft = await entry('VE', '2026-02-10', [['411000', '999', '0'], ['706000', '0', '999']], { status: 'draft' })
    await entry('VE', '2026-03-01', [['411000', '120', '0'], ['706000', '0', '100'], ['445710', '0', '20']])
    ids.company = company.id

    const other = await seedCompany('pnl-beta', '900000202')
    await other.entry('VE', '2026-01-10', [['411000', '777', '0'], ['706000', '0', '777']])
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('sums produits, chiffre d’affaires and charges per month across fiscal years, validated entries only', async () => {
    expect(await pnl.getMonthlyPnl(ids.company, { from: '2025-11', to: '2026-02' })).toEqual([
      { month: '2025-11', revenueCents: 0, chiffreAffairesCents: 0, expensesCents: 0, resultCents: 0 },
      { month: '2025-12', revenueCents: 100_000, chiffreAffairesCents: 100_000, expensesCents: 0, resultCents: 100_000 },
      { month: '2026-01', revenueCents: 53_050, chiffreAffairesCents: 45_050, expensesCents: 31_025, resultCents: 22_025 },
      { month: '2026-02', revenueCents: 0, chiffreAffairesCents: 0, expensesCents: 0, resultCents: 0 },
    ])
  })

  it('counts a draft once validated, and the first day of the month after in that month only', async () => {
    await svc.validateEntries(ids.company, [ids.draft])
    const months = await pnl.getMonthlyPnl(ids.company, { from: '2026-02', to: '2026-03' })
    expect(months).toEqual([
      { month: '2026-02', revenueCents: 99_900, chiffreAffairesCents: 99_900, expensesCents: 0, resultCents: 99_900 },
      { month: '2026-03', revenueCents: 10_000, chiffreAffairesCents: 10_000, expensesCents: 0, resultCents: 10_000 },
    ])
  })

  it('defaults to the last twelve full months in France', async () => {
    const months = await pnl.getMonthlyPnl(ids.company, {}, new Date('2026-02-28T23:30:00Z'))
    expect(months.map((m) => m.month)).toEqual([
      '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    ])
    expect(months.find((m) => m.month === '2026-01')?.resultCents).toBe(22_025)
  })
})
