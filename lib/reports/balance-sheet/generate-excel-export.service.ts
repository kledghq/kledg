/**
 * Generates Excel export for balance sheet
 */

import ExcelJS from 'exceljs'
import { roundEuros, subtractEuros } from '../amounts'
import type { BalanceSheetData, BalanceSheetLine } from './types'
import { generateBalanceSheetComparison } from './generate-comparison.service'

/**
 * Renders balance sheet lines to Excel rows
 */
function renderLinesToRows(
  lines: BalanceSheetLine[],
  level: number = 0,
  showBrutAmort: boolean = false
): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = []

  for (const line of lines) {
    const indent = '  '.repeat(level)
    const label = `${indent}${line.formCode ? `[${line.formCode}] ` : ''}${line.lineLabel}`

    if (showBrutAmort) {
      rows.push([
        label,
        roundEuros(line.brut || 0),
        roundEuros(line.amortissements || 0),
        roundEuros(line.net),
      ])
    } else {
      rows.push([label, roundEuros(line.net)])
    }

    if (line.children && line.children.length > 0) {
      rows.push(...renderLinesToRows(line.children, level + 1, showBrutAmort))
    }
  }

  return rows
}

/**
 * Generates Excel file for balance sheet
 *
 * @param balanceSheet - Balance sheet data
 * @param comparison - Optional comparison data (N vs N-1)
 * @returns Excel buffer
 */
export async function generateBalanceSheetExcel(
  balanceSheet: BalanceSheetData,
  comparison?: Awaited<ReturnType<typeof generateBalanceSheetComparison>>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const showBrutAmort = balanceSheet.actif.lines.some(
    (line) => line.brut !== undefined || line.amortissements !== undefined
  )

  // ACTIF sheet
  const actifSheet = workbook.addWorksheet('ACTIF')
  const actifHeaders = showBrutAmort
    ? ['Libellé', 'Brut', 'Amortissements', 'Net']
    : ['Libellé', 'Net']
  actifSheet.addRow(actifHeaders)
  for (const row of renderLinesToRows(balanceSheet.actif.lines, 0, showBrutAmort)) {
    actifSheet.addRow(row)
  }
  actifSheet.addRow(
    showBrutAmort
      ? [
          'TOTAL ACTIF',
          roundEuros(balanceSheet.actif.brutTotal || 0),
          roundEuros(balanceSheet.actif.amortissementsTotal || 0),
          roundEuros(balanceSheet.actifTotal),
        ]
      : ['TOTAL ACTIF', roundEuros(balanceSheet.actifTotal)]
  )
  actifSheet.columns = showBrutAmort
    ? [{ width: 50 }, { width: 15 }, { width: 15 }, { width: 15 }]
    : [{ width: 50 }, { width: 15 }]

  // PASSIF sheet
  const passifSheet = workbook.addWorksheet('PASSIF')
  passifSheet.addRow(['Libellé', 'Net'])
  for (const row of renderLinesToRows(balanceSheet.passif.lines, 0, false)) {
    passifSheet.addRow(row)
  }
  passifSheet.addRow(['TOTAL PASSIF', roundEuros(balanceSheet.passifTotal)])
  passifSheet.columns = [{ width: 50 }, { width: 15 }]

  // Comparison sheet
  if (comparison) {
    const comparisonSheet = workbook.addWorksheet('Comparaison')
    comparisonSheet.addRow(['Libellé', 'N', 'N-1', 'Variation', 'Variation %'])

    const addComparisonRows = (
      currentLines: BalanceSheetLine[],
      previousLines: BalanceSheetLine[],
      level: number = 0
    ) => {
      const previousMap = new Map<string, number>()
      const buildMap = (lines: BalanceSheetLine[]) => {
        for (const line of lines) {
          previousMap.set(line.id, line.net)
          if (line.children) buildMap(line.children)
        }
      }
      buildMap(previousLines)

      for (const line of currentLines) {
        const indent = '  '.repeat(level)
        const label = `${indent}${line.formCode ? `[${line.formCode}] ` : ''}${line.lineLabel}`
        const currentValue = line.net
        const previousValue = previousMap.get(line.id) || 0
        const variation = subtractEuros(currentValue, previousValue)
        const variationPercent = previousValue !== 0 ? (variation / previousValue) * 100 : 0

        comparisonSheet.addRow([
          label,
          roundEuros(currentValue),
          roundEuros(previousValue),
          roundEuros(variation),
          Math.round(variationPercent * 100) / 100, // percentage with two decimals
        ])

        if (line.children && line.children.length > 0) {
          const prevChildren = previousLines.find((l) => l.id === line.id)?.children || []
          addComparisonRows(line.children, prevChildren, level + 1)
        }
      }
    }

    comparisonSheet.addRow(['ACTIF'])
    addComparisonRows(comparison.current.actif.lines, comparison.previous.actif.lines)
    comparisonSheet.addRow([])
    comparisonSheet.addRow(['PASSIF'])
    addComparisonRows(comparison.current.passif.lines, comparison.previous.passif.lines)

    comparisonSheet.columns = [
      { width: 50 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
    ]
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer as ArrayBuffer)
}
