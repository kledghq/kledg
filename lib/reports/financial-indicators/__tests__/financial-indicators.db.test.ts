/**
 * Financial indicators against PostgreSQL, through their routes (session and
 * roles mocked): the figures of a fiscal year and of the previous one from
 * validated entries, the closing entry and the opening entry's VAT left out,
 * the result equal to the income statement and the BFR components equal to
 * the balance sheet lines, exports as CSV and Excel downloads, the dashboard
 * source, French errors for a fiscal year of another company, a company
 * without fiscal year and an unknown format. Skipped without the test
 * database server.
 *
 * Ledger of fiscal year 2025 (euros), hand-computed:
 *   AN  01/01  411 D 1 200 | 44571 C 200 | 101 C 1 000 (opening balances)
 *   VE  10/03  411 D 2 400 | 706 C 2 000 | 44571 C 400
 *   AC  10/04  601 D 1 000 | 44566 D 200 | 401 C 1 200
 *   OD  31/05  641 D 500   | 421 C 500
 *   BQ  15/06  512 D 2 400 | 411 C 2 400 (the March invoice is paid)
 *   BQ  20/06  401 D 600   | 512 C 600
 *   OD  31/12  681 D 100   | 2818 C 100
 *   CL  31/12  closing entry (must not count): 706 D 2 000 | 601 C 1 000 | 641 C 500 | 681 C 100 | 120 C 400
 * SIG: production vendue 2 000, consommations 1 000, valeur ajoutée 1 000,
 * EBE 1 000 - 500 = 500, résultat d'exploitation 500 - 100 = 400 = résultat.
 * CAF 400 + 100 = 500.
 * Bilan: clients 1 200, autres créances 200 (44566), fournisseurs 600, dettes
 * fiscales et sociales 500 + 600 = 1 100: BFR 1 200 + 200 - 600 - 1 100 = -300.
 * Trésorerie nette 2 400 - 600 = 1 800. Capitaux propres 1 000 + 400 = 1 400.
 * VAT of the flows: collected 400 (the 200 of the opening entry is a balance,
 * not a sale of 2025), deductible 200. DSO = 1 200 / (2 000 + 400) x 365 =
 * 182.5 -> 183 days (168 if the opening VAT were counted). DPO = 600 /
 * (1 000 + 200) x 365 = 183 days.
 * Fiscal year 2024: one sale, 706 C 1 000: EBE and result 1 000.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'

const ids = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('financial_indicators')
  return {} as Record<string, string>
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'compta@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  // Member of the seeded companies only.
  return {
    ...actual,
    getUserRolesForCompany: vi.fn(async (_userId: string, companyId: string) => (companyId === ids.company || companyId === ids.empty ? ['companyAdmin'] : [])),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import type { FinancialIndicatorsReport } from '../get-financial-indicators.service'
import type { BalanceSheetLine } from '@/lib/reports/balance-sheet/types'

const available = await testDatabaseAvailable()

type Handler = (request: NextRequest) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
const routes = {} as Record<'report' | 'export' | 'widgets', Handler>

const get = (handler: Handler, path: string) => handler(new NextRequest(`http://localhost${path}`))
const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const euros = (value: number) => Math.round(value * 100)

async function seed() {
  const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
  const company = await prisma.company.create({ data: { name: 'Atelier Été', slug: 'atelier', siren: '123456789' } })
  const empty = await prisma.company.create({ data: { name: 'Sans exercice', slug: 'vide', siren: '111222333' } })
  await seedMembership(prisma, 'user-1', company.id)
  await seedMembership(prisma, 'user-1', empty.id)
  const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
  const otherFy = await prisma.fiscalYear.create({ data: { companyId: other.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })

  const fy2024 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2024, startDate: day('2024-01-01'), endDate: day('2024-12-31') } })
  const fy2025 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  const journal = async (code: string, label: string) => (await prisma.journal.create({ data: { companyId: company.id, code, label } })).id
  const j = { AN: await journal('AN', 'À-nouveaux'), VE: await journal('VE', 'Ventes'), AC: await journal('AC', 'Achats'), OD: await journal('OD', 'Opérations diverses'), BQ: await journal('BQ', 'Banque'), CL: await journal('CL', 'Journal de clôture') }

  const chart = async (fiscalYearId: string, codes: Array<[string, string]>) => {
    const out: Record<string, string> = {}
    for (const [code, label] of codes) out[code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId, code, label } })).id
    return out
  }
  const a = await chart(fy2025.id, [
    ['101000', 'Capital'], ['120000', 'Résultat'], ['281830', 'Amortissements'], ['401000', 'Fournisseurs'], ['411000', 'Clients'], ['421000', 'Personnel'],
    ['445660', 'TVA déductible'], ['445710', 'TVA collectée'], ['512000', 'Banque'], ['601000', 'Achats de matières'], ['641100', 'Salaires'],
    ['681120', 'Dotations'], ['706000', 'Prestations'],
  ])
  const b = await chart(fy2024.id, [['411000', 'Clients'], ['445710', 'TVA collectée'], ['706000', 'Prestations']])

  const entry = (journalId: string, date: string, description: string, lines: Array<[string, number, number]>, reference?: string) =>
    createEntry({
      companyId: company.id,
      journalId,
      date,
      description,
      reference,
      status: 'validated',
      lines: lines.map(([accountId, debit, credit]) => ({ accountId, debit: String(debit), credit: String(credit) })),
    })
  await entry(j.VE, '2024-05-02', 'Facture 2024', [[b['411000'], 1_200, 0], [b['706000'], 0, 1_000], [b['445710'], 0, 200]])
  await entry(j.AN, '2025-01-01', 'À-nouveaux', [[a['411000'], 1_200, 0], [a['445710'], 0, 200], [a['101000'], 0, 1_000]])
  await entry(j.VE, '2025-03-10', 'Facture 1', [[a['411000'], 2_400, 0], [a['706000'], 0, 2_000], [a['445710'], 0, 400]])
  await entry(j.AC, '2025-04-10', 'Matières', [[a['601000'], 1_000, 0], [a['445660'], 200, 0], [a['401000'], 0, 1_200]])
  await entry(j.OD, '2025-05-31', 'Salaires', [[a['641100'], 500, 0], [a['421000'], 0, 500]])
  await entry(j.BQ, '2025-06-15', 'Règlement client', [[a['512000'], 2_400, 0], [a['411000'], 0, 2_400]])
  await entry(j.BQ, '2025-06-20', 'Règlement fournisseur', [[a['401000'], 600, 0], [a['512000'], 0, 600]])
  await entry(j.OD, '2025-12-31', 'Dotation', [[a['681120'], 100, 0], [a['281830'], 0, 100]])
  await entry(
    j.CL,
    '2025-12-31',
    'Clôture',
    [[a['706000'], 2_000, 0], [a['601000'], 0, 1_000], [a['641100'], 0, 500], [a['681120'], 0, 100], [a['120000'], 0, 400]],
    'CL-2025',
  )
  Object.assign(ids, { company: company.id, empty: empty.id, other: other.id, otherFy: otherFy.id, fy2024: fy2024.id, fy2025: fy2025.id })
}

describe.skipIf(!available)('financial indicators', () => {
  beforeAll(async () => {
    await prepareTestDatabase('financial_indicators')
    ;({ prisma } = await import('@/lib/prisma'))
    routes.report = (await import('@/app/api/reports/financial-indicators/route')).GET as unknown as Handler
    routes.export = (await import('@/app/api/reports/financial-indicators/export/route')).GET as unknown as Handler
    routes.widgets = (await import('@/app/api/dashboard/widgets/route')).GET as unknown as Handler
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('computes the SIG, CAF, BFR, delays and ratios of a fiscal year and of the previous one', async () => {
    const response = await get(routes.report, `/api/reports/financial-indicators?companyId=${ids.company}&fiscalYearId=${ids.fy2025}`)
    expect(response.status).toBe(200)
    const report = (await response.json()) as FinancialIndicatorsReport
    expect(report.fiscalYear).toEqual({ id: ids.fy2025, year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', isClosed: false, asOf: '2025-12-31' })
    expect(report.current.sig).toMatchObject({
      chiffreAffairesCents: euros(2_000),
      productionExerciceCents: euros(2_000),
      consommationsTiersCents: euros(1_000),
      valeurAjouteeCents: euros(1_000),
      ebeCents: euros(500),
      resultatExploitationCents: euros(400),
      resultatExerciceCents: euros(400),
      hasMarchandises: false,
    })
    expect(report.current.caf.cafCents).toBe(euros(500))
    expect(report.current.bilan).toMatchObject({
      creancesClientsCents: euros(1_200),
      autresCreancesExploitationCents: euros(200),
      dettesFournisseursCents: euros(600),
      dettesFiscalesSocialesCents: euros(1_100),
      bfrCents: euros(-300),
      tresorerieNetteCents: euros(1_800),
      capitauxPropresCents: euros(1_400),
    })
    expect(report.current.delais).toMatchObject({ days: 365, chiffreAffairesTtcCents: euros(2_400), achatsTtcCents: euros(1_200), dsoDays: 183, dpoDays: 183 })
    expect(report.current.ratios).toMatchObject({ tauxMarge: null, margeEbe: 0.25, margeNette: 0.2, endettement: 0 })

    expect(report.previous?.fiscalYear).toMatchObject({ id: ids.fy2024, year: 2024, asOf: '2024-12-31' })
    expect(report.previous?.indicators.sig.ebeCents).toBe(euros(1_000))
    expect(report.previous?.indicators.delais.days).toBe(366)
  })

  it('ends on the income statement result and reads the BFR on the balance sheet lines', async () => {
    const { generateIncomeStatement } = await import('@/lib/reports/income-statement/generate-income-statement.service')
    const { generateBalanceSheet } = await import('@/lib/reports/balance-sheet/generate-balance-sheet.service')
    const { getFinancialIndicators } = await import('../get-financial-indicators.service')
    const report = await getFinancialIndicators(ids.company, { fiscalYearId: ids.fy2025 })
    const statement = await generateIncomeStatement(ids.company, ids.fy2025, 'complete')
    expect(euros(statement.netResult)).toBe(report.current.sig.resultatExerciceCents)
    expect(euros(statement.intermediateResults!.resultatExploitation!)).toBe(report.current.sig.resultatExploitationCents)

    const sheet = await generateBalanceSheet(ids.company, ids.fy2025, 'complete')
    const lines = new Map<string, number>()
    const visit = (line: BalanceSheetLine) => {
      if (line.formCode && !lines.has(line.formCode)) lines.set(line.formCode, euros(line.net ?? 0))
      line.children?.forEach(visit)
    }
    ;[...sheet.actif.lines, ...sheet.passif.lines].forEach(visit)
    expect(report.current.bilan.creancesClientsCents).toBe(lines.get('BX'))
    expect(report.current.bilan.autresCreancesExploitationCents).toBe((lines.get('BV') ?? 0) + (lines.get('BZ') ?? 0))
    expect(report.current.bilan.dettesFournisseursCents).toBe(lines.get('DX'))
    expect(report.current.bilan.dettesFiscalesSocialesCents).toBe(lines.get('DY'))
    expect(report.current.bilan.capitauxPropresCents).toBe(lines.get('DL'))
  })

  it('reads the latest fiscal year by default and answers 404 for a fiscal year of another company', async () => {
    const byDefault = await get(routes.report, `/api/reports/financial-indicators?companyId=${ids.company}`)
    expect(byDefault.status).toBe(200)
    expect(((await byDefault.json()) as FinancialIndicatorsReport).fiscalYear.id).toBe(ids.fy2025)

    const foreign = await get(routes.report, `/api/reports/financial-indicators?companyId=${ids.company}&fiscalYearId=${ids.otherFy}`)
    expect(foreign.status).toBe(404)
    expect(await errorOf(foreign)).toBe('Exercice introuvable pour cette société.')

    const none = await get(routes.report, `/api/reports/financial-indicators?companyId=${ids.empty}`)
    expect(none.status).toBe(400)
    expect(await errorOf(none)).toBe("Aucun exercice pour cette société : créez d'abord un exercice.")

    const notMember = await get(routes.report, `/api/reports/financial-indicators?companyId=${ids.other}`)
    expect(notMember.status).toBe(404)
  })

  it('exports the rows as a CSV file and an Excel workbook', async () => {
    const csv = await get(routes.export, `/api/reports/financial-indicators/export?companyId=${ids.company}&fiscalYearId=${ids.fy2025}&format=csv`)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(csv.headers.get('content-disposition')).toContain('SIG_Atelier__t__2025.csv')
    const bytes = new Uint8Array(await csv.arrayBuffer())
    // UTF-8 byte order mark, so Excel reads the accents (Response.text() would strip it)
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain("Soldes intermédiaires de gestion;Excédent brut d'exploitation (EBE);Solde;€;500,00;1000,00;-500,00;")
    expect(text).toContain('Besoin en fonds de roulement et trésorerie;Besoin en fonds de roulement (BFR);Solde;€;-300,00;')
    expect(text).toContain('Ratios et délais;Délai de paiement des clients (DSO);;jours;183;')

    const xlsx = await get(routes.export, `/api/reports/financial-indicators/export?companyId=${ids.company}&fiscalYearId=${ids.fy2025}`)
    expect(xlsx.status).toBe(200)
    expect(xlsx.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await xlsx.arrayBuffer())
    const sheet = workbook.getWorksheet('SIG et ratios')!
    const ebe = sheet.getRows(1, sheet.rowCount)!.find((row) => row.getCell(2).value === "Excédent brut d'exploitation (EBE)")!
    expect([ebe.getCell(5).value, ebe.getCell(6).value, ebe.getCell(7).value]).toEqual([500, 1000, -500])

    const invalid = await get(routes.export, `/api/reports/financial-indicators/export?companyId=${ids.company}&format=pdf`)
    expect(invalid.status).toBe(400)
    expect(await errorOf(invalid)).toContain("Format d'export inconnu : csv ou xlsx")
  })

  it('feeds the dashboard widgets from the same figures', async () => {
    const response = await get(routes.widgets, `/api/dashboard/widgets?companyId=${ids.company}&source=indicators&fiscalYearId=${ids.fy2025}`)
    expect(response.status).toBe(200)
    const data = (await response.json()) as { fiscalYear: { id: string }; asOf: string; indicators: FinancialIndicatorsReport['current'] }
    expect(data.fiscalYear.id).toBe(ids.fy2025)
    expect(data.asOf).toBe('2025-12-31')
    expect(data.indicators.sig.ebeCents).toBe(euros(500))
    expect(data.indicators.caf.cafCents).toBe(euros(500))
    expect(data.indicators.bilan.bfrCents).toBe(euros(-300))
    expect([data.indicators.delais.dsoDays, data.indicators.delais.dpoDays]).toEqual([183, 183])
  })
})
