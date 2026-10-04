/**
 * Excel exports of the statements built from hand-made statement data, for
 * the cases the seeded statements do not reach: a balance sheet without
 * Brut / Amortissements columns, values rounded to the cent, hidden labels
 * and an income statement without intermediate results. The workbooks are
 * read back with exceljs.
 */

import { describe, expect, it } from 'vitest'
import { generateBalanceSheetExcel } from '@/lib/reports/balance-sheet/generate-excel-export.service'
import { generateIncomeStatementExcel } from '@/lib/reports/income-statement/generate-excel-export.service'
import type { BalanceSheetData, BalanceSheetLine } from '@/lib/reports/balance-sheet/types'
import type { IncomeStatementData, IncomeStatementLine } from '@/lib/reports/income-statement/types'
import { readWorkbook, rowsOf } from './helpers/workbook'

const generatedAt = new Date('2026-01-15T10:00:00.000Z')

function bsLine(id: string, lineLabel: string, net: number, extra: Partial<BalanceSheetLine> = {}): BalanceSheetLine {
  return { id, lineLabel, value: net, net, accounts: [], order: 1, ...extra }
}

function balanceSheet(actif: BalanceSheetLine[], passif: BalanceSheetLine[], total: number): BalanceSheetData {
  return {
    companyId: 'c',
    fiscalYearId: 'fy',
    reportVariant: 'simplified',
    actif: { label: 'ACTIF', lines: actif, total, netTotal: total },
    passif: { label: 'PASSIF', lines: passif, total, netTotal: total },
    actifTotal: total,
    passifTotal: total,
    generatedAt,
  }
}

function isLine(id: string, lineLabel: string, value: number, extra: Partial<IncomeStatementLine> = {}): IncomeStatementLine {
  return { id, lineLabel, value, accounts: [], order: 1, ...extra }
}

describe('generateBalanceSheetExcel', () => {
  it('writes a single Net column when no actif line has depreciation columns, values rounded to the cent', async () => {
    // 0.1 + 0.2 in floating point: the cell holds 0,30.
    const data = balanceSheet(
      [bsLine('a1', 'Actif circulant', 0.1 + 0.2, { formCode: '096', children: [bsLine('a2', 'Disponibilités', 0.1 + 0.2, { formCode: '084' })] })],
      [bsLine('p1', 'Capitaux propres', 0.3, { formCode: '142' })],
      0.1 + 0.2,
    )
    const workbook = await readWorkbook(await generateBalanceSheetExcel(data))
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['ACTIF', 'PASSIF'])
    expect(rowsOf(workbook.getWorksheet('ACTIF'))).toEqual([
      ['Libellé', 'Net'],
      ['[096] Actif circulant', 0.3],
      ['  [084] Disponibilités', 0.3],
      ['TOTAL ACTIF', 0.3],
    ])
    expect(rowsOf(workbook.getWorksheet('PASSIF'))).toEqual([['Libellé', 'Net'], ['[142] Capitaux propres', 0.3], ['TOTAL PASSIF', 0.3]])
  })

  it('compares nested lines with the same line of N-1, and a line new in N with 0', async () => {
    const current = balanceSheet(
      [bsLine('g', 'Créances', 1500, { children: [bsLine('c', 'Clients', 1000), bsLine('n', 'Nouvelle ligne', 500)] })],
      [],
      1500,
    )
    const previous = balanceSheet([bsLine('g', 'Créances', 800, { children: [bsLine('c', 'Clients', 800)] })], [], 800)
    const comparison = {
      current,
      previous,
      variations: { actifVariation: 700, actifVariationPercent: 87.5, passifVariation: 0, passifVariationPercent: 0, lineVariations: new Map() },
    }
    const workbook = await readWorkbook(await generateBalanceSheetExcel(current, comparison))
    expect(rowsOf(workbook.getWorksheet('Comparaison'))).toEqual([
      ['Libellé', 'N', 'N-1', 'Variation', 'Variation %'],
      ['ACTIF'],
      ['Créances', 1500, 800, 700, 87.5],
      ['  Clients', 1000, 800, 200, 25],
      ['  Nouvelle ligne', 500, 0, 500, 0],
      ['PASSIF'],
    ])
  })
})

describe('generateIncomeStatementExcel', () => {
  it('leaves a hidden label empty and writes only the totals and the net result without intermediate results', async () => {
    const data: IncomeStatementData = {
      companyId: 'c',
      fiscalYearId: 'fy',
      reportVariant: 'complete',
      produits: {
        label: 'Produits',
        total: 1200.1,
        lines: [isLine('p', "Chiffre d'affaires net", 1200.1, { formCode: 'FL', children: [isLine('p1', 'Groupe masqué', 1200.1, { hideLabel: true })] })],
      },
      charges: { label: 'Charges', total: 1300, lines: [isLine('c', 'Autres achats et charges externes', 1300, { formCode: 'FW' })] },
      totalProduits: 1200.1,
      totalCharges: 1300,
      netResult: -99.9,
      generatedAt,
    }
    const workbook = await readWorkbook(await generateIncomeStatementExcel(data))
    expect(rowsOf(workbook.getWorksheet('PRODUITS'))).toEqual([
      ['Libellé', 'Montant'],
      ["[FL] Chiffre d'affaires net", 1200.1],
      ['', 1200.1],
      ['TOTAL PRODUITS', 1200.1],
    ])
    expect(rowsOf(workbook.getWorksheet('CHARGES'))).toEqual([
      ['Libellé', 'Montant'],
      ['[FW] Autres achats et charges externes', 1300],
      ['TOTAL CHARGES', 1300],
    ])
    // A loss is a negative net result (PCG art. 821-2: bénéfice ou perte).
    expect(rowsOf(workbook.getWorksheet('Résultat'))).toEqual([
      ['Libellé', 'Montant'],
      ['Total produits', 1200.1],
      ['Total charges', 1300],
      ['RÉSULTAT NET', -99.9],
    ])
  })
})
