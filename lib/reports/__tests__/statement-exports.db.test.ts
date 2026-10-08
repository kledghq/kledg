/**
 * Annual statements computed from seeded entries over two fiscal years, and
 * what is built from them: the Excel exports (read back with exceljs), the N
 * vs N-1 comparison, the check that the balance sheet carries the result of
 * the income statement, and the data handed to the PDF templates. Skipped
 * without the test database server.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('rep_statement_exports')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { generateBalanceSheet } from '@/lib/reports/balance-sheet/generate-balance-sheet.service'
import { generateBalanceSheetComparison } from '@/lib/reports/balance-sheet/generate-comparison.service'
import { generateBalanceSheetExcel } from '@/lib/reports/balance-sheet/generate-excel-export.service'
import { validateBalanceSheetAgainstIncomeStatement } from '@/lib/reports/balance-sheet/validate-income-statement.service'
import { generateIncomeStatement } from '@/lib/reports/income-statement/generate-income-statement.service'
import { generateIncomeStatementExcel } from '@/lib/reports/income-statement/generate-excel-export.service'
import { generateBalanceSheetPDFData } from '@/lib/pdf/generate-balance-sheet-pdf-data.service'
import { generateIncomeStatementPDFData } from '@/lib/pdf/generate-income-statement-pdf-data.service'
import { readWorkbook, rowsOf } from './helpers/workbook'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seed() {
  const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
  const company = await prisma.company.create({
    // An https logo outside LOGO_ALLOWED_HOSTS: dropped from the PDF data (lib/companies/logo.ts).
    data: { name: 'Atelier Lumière', slug: 'atelier-lumiere', siren: '552100554', logo: 'https://evil.example/logo.png' },
  })
  const address = await prisma.address.create({
    data: { companyId: company.id, street: '12 rue des Lilas', street2: 'Bâtiment B', postalCode: '69003', city: 'Lyon', country: 'FR' },
  })
  await prisma.company.update({ where: { id: company.id }, data: { headquartersAddressId: address.id } })
  const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
  const fy2024 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2024, startDate: day('2024-01-01'), endDate: day('2024-12-31') } })
  const fy2025 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  const otherFy = await prisma.fiscalYear.create({ data: { companyId: other.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Opérations diverses' } })

  const accountsOf = async (fiscalYearId: string, codes: Record<string, string>) => {
    const out: Record<string, string> = {}
    for (const [code, label] of Object.entries(codes)) {
      out[code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId, code, label } })).id
    }
    return out
  }
  const chart = {
    '101000': 'Capital',
    '110000': 'Report à nouveau',
    '411000': 'Clients',
    '445710': 'TVA collectée',
    '512000': 'Banque',
    '626000': 'Frais postaux',
    '706000': 'Prestations de services',
  }
  const a24 = await accountsOf(fy2024.id, chart)
  const a25 = await accountsOf(fy2025.id, chart)
  const entry = (date: string, description: string, lines: Array<[string, string, string]>) =>
    createEntry({
      companyId: company.id,
      journalId: journal.id,
      date,
      description,
      status: 'validated',
      lines: lines.map(([accountId, debit, credit]) => ({ accountId, debit, credit })),
    })

  // 2024: capital paid in, one service sold for 800,00.
  await entry('2024-01-05', 'Apport en capital', [[a24['512000'], '5000.00', '0'], [a24['101000'], '0', '5000.00']])
  await entry('2024-06-30', 'Prestation 2024', [[a24['512000'], '800.00', '0'], [a24['706000'], '0', '800.00']])

  // 2025: opening balances, a 1 200,00 service sold with 20 % VAT and paid, 100,00 of postage.
  await entry('2025-01-01', 'À-nouveaux', [
    [a25['512000'], '5800.00', '0'],
    [a25['101000'], '0', '5000.00'],
    [a25['110000'], '0', '800.00'],
  ])
  await entry('2025-03-10', 'Facture FA-1', [[a25['411000'], '1440.00', '0'], [a25['706000'], '0', '1200.00'], [a25['445710'], '0', '240.00']])
  await entry('2025-04-10', 'Règlement FA-1', [[a25['512000'], '1440.00', '0'], [a25['411000'], '0', '1440.00']])
  await entry('2025-05-02', 'Affranchissement', [[a25['626000'], '100.00', '0'], [a25['512000'], '0', '100.00']])

  Object.assign(ids, { company: company.id, other: other.id, fy2024: fy2024.id, fy2025: fy2025.id, otherFy: otherFy.id })
}

function flat<T extends { children?: T[] }>(lines: T[]): T[] {
  return lines.flatMap((line) => [line, ...flat(line.children ?? [])])
}

describe.skipIf(!available)('statements built from seeded entries', () => {
  beforeAll(async () => {
    await prepareTestDatabase('rep_statement_exports')
    ;({ prisma } = await import('@/lib/prisma'))
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('balance sheet and income statement (2033-A / 2033-B layout)', () => {
    it('puts each balance in its rubric of the simplified balance sheet (notice 2033-A)', async () => {
      const bs = await generateBalanceSheet(ids.company, ids.fy2025, 'simplified')
      const lines = flat([...bs.actif.lines, ...bs.passif.lines])
      const net = (formCode: string) => lines.find((l) => l.formCode === formCode)?.net
      // 2033-A line 084 Disponibilités: 5 800,00 opening + 1 440,00 received - 100,00 paid.
      expect(net('084')).toBe(7140)
      expect(net('068')).toBe(0) // the customer paid: nothing left on 411
      expect(net('120')).toBe(5000) // Capital social
      expect(net('134')).toBe(800) // Report à nouveau
      // 2033-A line 136 Résultat de l'exercice: 1 200,00 of 706 - 100,00 of 626 (PCG art. 821-1).
      expect(net('136')).toBe(1100)
      expect(net('172')).toBe(240) // TVA collectée in Dettes fiscales et sociales
      expect(net('142')).toBe(6900) // Capitaux propres
      expect(net('176')).toBe(240) // Total dettes
      // The balance sheet balances (PCG art. 821-1): actif = passif.
      expect([bs.actifTotal, bs.passifTotal, bs.imbalance, bs.netResult]).toEqual([7140, 7140, undefined, 1100])
    })

    it('puts the sale and the expense in their rubric of the simplified income statement (notice 2033-B)', async () => {
      const is = await generateIncomeStatement(ids.company, ids.fy2025, 'simplified')
      const lines = flat([...is.produits.lines, ...is.charges.lines])
      const value = (formCode: string) => lines.find((l) => l.formCode === formCode)?.value
      expect(value('218')).toBe(1200) // production vendue de services: 706, VAT excluded (notice 2033-B, 218)
      expect(value('232')).toBe(1200) // Total des produits d'exploitation (I)
      expect(value('242')).toBe(100) // Autres charges externes: 626 (frais postaux, notice 2033-B, 242)
      expect(value('234')).toBe(0) // Achats de marchandises
      expect(value('264')).toBe(100) // Total des charges d'exploitation (II)
      expect(value('310')).toBe(1100) // Bénéfice ou perte
      expect(is.intermediateResults).toEqual({ resultatExploitation: 1100, resultatFinancier: 0, resultatCourant: 1100, resultatExceptionnel: 0 })
    })
  })

  describe('Excel exports', () => {
    it('exports the balance sheet with its N and N-1 columns (notice 2033-A)', async () => {
      const current = await generateBalanceSheet(ids.company, ids.fy2025, 'simplified')
      const comparison = await generateBalanceSheetComparison(ids.company, ids.fy2025, ids.fy2024, 'simplified')
      const workbook = await readWorkbook(await generateBalanceSheetExcel(current, comparison))
      expect(workbook.worksheets.map((s) => s.name)).toEqual(['ACTIF', 'PASSIF', 'Comparaison'])

      const actif = rowsOf(workbook.getWorksheet('ACTIF'))
      expect(actif[0]).toEqual(['Libellé', 'Brut', 'Amortissements', 'Net'])
      expect(actif).toContainEqual(['[096] Actif circulant', 7140, 0, 7140])
      expect(actif).toContainEqual(['    [068] Clients et comptes rattachés', 0, 0, 0])
      // A net-only line leaves Brut and Amortissements empty (regression: 0 next to a 7 140,00 net).
      const cash = actif.find((row) => row[0] === '  [084] Disponibilités')
      expect(cash).toEqual(['  [084] Disponibilités', undefined, undefined, 7140])
      expect(cash).toHaveLength(4)
      expect(actif.at(-1)).toEqual(['TOTAL ACTIF', 7140, 0, 7140])

      const passif = rowsOf(workbook.getWorksheet('PASSIF'))
      expect(passif[0]).toEqual(['Libellé', 'Net'])
      expect(passif).toContainEqual(['[142] Capitaux propres', 6900])
      expect(passif).toContainEqual(['  [120] Capital social ou individuel', 5000])
      expect(passif).toContainEqual(["  [136] Résultat de l'exercice", 1100])
      expect(passif).toContainEqual(['  [172] Dettes fiscales et sociales', 240])
      expect(passif.at(-1)).toEqual(['TOTAL PASSIF', 7140])

      const compared = rowsOf(workbook.getWorksheet('Comparaison'))
      expect(compared[0]).toEqual(['Libellé', 'N', 'N-1', 'Variation', 'Variation %'])
      expect(compared[1]).toEqual(['ACTIF'])
      // 7 140,00 in 2025 against 5 800,00 in 2024: +1 340,00, +23,1 %.
      expect(compared).toContainEqual(['  [084] Disponibilités', 7140, 5800, 1340, 23.1])
      expect(compared).toContainEqual(['  [134] Report à nouveau', 800, 0, 800, 0])
      expect(compared).toContainEqual(["  [136] Résultat de l'exercice", 1100, 800, 300, 37.5])
      expect(compared).toContainEqual(['PASSIF'])
    })

    it('exports the income statement with its totals and intermediate results (notice 2033-B)', async () => {
      const is = await generateIncomeStatement(ids.company, ids.fy2025, 'simplified')
      const workbook = await readWorkbook(await generateIncomeStatementExcel(is))
      expect(workbook.worksheets.map((s) => s.name)).toEqual(['PRODUITS', 'CHARGES', 'Résultat'])

      const produits = rowsOf(workbook.getWorksheet('PRODUITS'))
      expect(produits.slice(0, 3)).toEqual([
        ['Libellé', 'Montant'],
        ["[232] Total des produits d'exploitation hors TVA (I)", 1200],
        ['  [210] Ventes de marchandises', 0],
      ])
      expect(produits.at(-1)).toEqual(['TOTAL PRODUITS', 1200])

      const charges = rowsOf(workbook.getWorksheet('CHARGES'))
      expect(charges).toContainEqual(['  [242] Autres charges externes', 100])
      expect(produits).toContainEqual(['  [218] Production vendue - Services', 1200])
      expect(charges.at(-1)).toEqual(['TOTAL CHARGES', 100])

      expect(rowsOf(workbook.getWorksheet('Résultat'))).toEqual([
        ['Libellé', 'Montant'],
        ['Total produits', 1200],
        ['Total charges', 100],
        ["Résultat d'exploitation", 1100],
        ['Résultat financier', 0],
        ['Résultat courant avant impôts', 1100],
        ['Résultat exceptionnel', 0],
        ['RÉSULTAT NET', 1100],
      ])
    })
  })

  describe('N vs N-1 comparison', () => {
    it('computes the variation of the totals and of each line, in cents', async () => {
      const { current, previous, variations } = await generateBalanceSheetComparison(ids.company, ids.fy2025, ids.fy2024, 'simplified')
      expect([current.actifTotal, previous.actifTotal]).toEqual([7140, 5800])
      expect(variations.actifVariation).toBe(1340)
      expect(variations.actifVariationPercent).toBeCloseTo(23.1034, 4)
      expect(variations.passifVariation).toBe(1340)

      const lineId = (formCode: string) => flat([...current.actif.lines, ...current.passif.lines]).find((l) => l.formCode === formCode)!.id
      expect(variations.lineVariations.get(lineId('084'))).toEqual({ absolute: 1340, percent: expect.closeTo(23.1034, 4), isSignificant: true })
      expect(variations.lineVariations.get(lineId('120'))).toEqual({ absolute: 0, percent: 0, isSignificant: false })
      // A line that was 0,00: no percentage, significant only above 1 000,00.
      expect(variations.lineVariations.get(lineId('134'))).toEqual({ absolute: 800, percent: 0, isSignificant: false })
      // 1 100,00 against 800,00: +37,5 %, above the 10 % threshold.
      expect(variations.lineVariations.get(lineId('136'))).toEqual({ absolute: 300, percent: 37.5, isSignificant: true })
    })

    it('answers 404 for a fiscal year of another company', async () => {
      await expect(generateBalanceSheetComparison(ids.company, ids.fy2025, ids.otherFy)).rejects.toThrow('Exercice fiscal introuvable')
    })
  })

  describe('result of the balance sheet against the income statement (PCG art. 821-1 and 821-3)', () => {
    it('matches when the result line carries the net result of the year', async () => {
      expect(await validateBalanceSheetAgainstIncomeStatement(ids.company, ids.fy2025, 'simplified')).toEqual({
        balanceSheetResult: 1100,
        incomeStatementResult: 1100,
        matches: true,
        difference: 0,
        errors: [],
        warnings: [],
      })
      expect((await validateBalanceSheetAgainstIncomeStatement(ids.company, ids.fy2024, 'complete')).matches).toBe(true)
    })

    it('reports an unbalanced balance sheet with a French message', async () => {
      const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
      const company = await prisma.company.create({ data: { name: 'Déséquilibre', slug: 'desequilibre', siren: '111222333' } })
      const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
      const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Opérations diverses' } })
      const account = async (code: string, label: string) =>
        (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })).id
      // A class 8 account (engagements) belongs to no rubric of the balance sheet.
      await createEntry({
        companyId: company.id,
        journalId: journal.id,
        date: '2025-02-01',
        description: 'Engagement reçu',
        status: 'validated',
        lines: [
          { accountId: await account('512000', 'Banque'), debit: '50.00', credit: '0' },
          { accountId: await account('801000', 'Engagements donnés'), debit: '0', credit: '50.00' },
        ],
      })
      const result = await validateBalanceSheetAgainstIncomeStatement(company.id, fy.id, 'simplified')
      expect(result.matches).toBe(false)
      expect(result.difference).toBe(0)
      expect(result.errors).toEqual(["Le bilan n'est pas équilibré : écart de 50,00 €"])
    })
  })

  describe('PDF data', () => {
    it('gives the balance sheet with the company header, address and fiscal year (form 2050)', async () => {
      const data = await generateBalanceSheetPDFData(ids.company, ids.fy2025, 'complete')
      expect(data.company).toEqual({
        id: ids.company,
        name: 'Atelier Lumière',
        siren: '552100554',
        address: '12 rue des Lilas, Bâtiment B, 69003 Lyon',
        logo: null,
      })
      expect(data.fiscalYear).toEqual({ id: ids.fy2025, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') })
      const lines = flat([...data.balanceSheet.actif.lines, ...data.balanceSheet.passif.lines])
      const net = (formCode: string) => lines.find((l) => l.formCode === formCode)?.net
      // Complete layout, forms 2050 (actif) and 2051 (passif).
      expect([net('CF'), net('DA'), net('DI'), net('DY')]).toEqual([7140, 5000, 1100, 240])
      expect(data.balanceSheet.actifTotal).toBe(7140)
    })

    it('gives the income statement with the company header (form 2052)', async () => {
      const data = await generateIncomeStatementPDFData(ids.company, ids.fy2025, 'complete')
      expect(data.company.address).toBe('12 rue des Lilas, Bâtiment B, 69003 Lyon')
      expect(data.fiscalYear.year).toBe(2025)
      const lines = flat([...data.incomeStatement.produits.lines, ...data.incomeStatement.charges.lines])
      const value = (formCode: string) => lines.find((l) => l.formCode === formCode)?.value
      // 2052: FG Production vendue de services (706), FW Autres achats et charges externes (626).
      expect([value('FG'), value('FW')]).toEqual([1200, 100])
      expect(data.incomeStatement.netResult).toBe(1100)
    })

    it('leaves the address empty without a head office and keeps an inline logo', async () => {
      const logo = 'data:image/png;base64,iVBORw0KGgo='
      await prisma.company.update({ where: { id: ids.other }, data: { logo } })
      const data = await generateIncomeStatementPDFData(ids.other, ids.otherFy, 'simplified')
      expect(data.company).toMatchObject({ name: 'Autre', address: null, logo })
      expect(data.incomeStatement.netResult).toBe(0)
    })

    it('answers 404 for a missing company, a missing fiscal year or one of another company', async () => {
      await expect(generateBalanceSheetPDFData('missing', ids.fy2025)).rejects.toThrow('Société introuvable')
      await expect(generateBalanceSheetPDFData(ids.company, 'missing')).rejects.toThrow('Exercice fiscal introuvable')
      await expect(generateBalanceSheetPDFData(ids.company, ids.otherFy)).rejects.toThrow('Exercice fiscal introuvable')
      await expect(generateIncomeStatementPDFData('missing', ids.fy2025)).rejects.toThrow('Société introuvable')
      await expect(generateIncomeStatementPDFData(ids.company, 'missing')).rejects.toThrow('Exercice fiscal introuvable')
      await expect(generateIncomeStatementPDFData(ids.company, ids.otherFy)).rejects.toThrow('Exercice fiscal introuvable')
    })
  })
})
