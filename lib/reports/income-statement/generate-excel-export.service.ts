/**
 * Generates Excel export for income statement
 */

import ExcelJS from 'exceljs'
import { roundEuros } from '../amounts'
import type { IncomeStatementData, IncomeStatementLine } from './types'

function renderLinesToRows(
  lines: IncomeStatementLine[],
  level: number = 0
): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = []

  for (const line of lines) {
    const indent = '  '.repeat(level)
    const label = line.hideLabel
      ? ''
      : `${indent}${line.formCode ? `[${line.formCode}] ` : ''}${line.lineLabel}`
    rows.push([label, roundEuros(line.value)])

    if (line.children && line.children.length > 0) {
      rows.push(...renderLinesToRows(line.children, level + 1))
    }
  }

  return rows
}

/**
 * Generates Excel file for income statement
 */
export async function generateIncomeStatementExcel(
  incomeStatement: IncomeStatementData
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()

  // PRODUITS
  const produitsSheet = workbook.addWorksheet('PRODUITS')
  produitsSheet.addRow(['Libellé', 'Montant'])
  for (const row of renderLinesToRows(incomeStatement.produits.lines)) {
    produitsSheet.addRow(row)
  }
  produitsSheet.addRow(['TOTAL PRODUITS', roundEuros(incomeStatement.totalProduits)])
  produitsSheet.columns = [{ width: 60 }, { width: 18 }]

  // CHARGES
  const chargesSheet = workbook.addWorksheet('CHARGES')
  chargesSheet.addRow(['Libellé', 'Montant'])
  for (const row of renderLinesToRows(incomeStatement.charges.lines)) {
    chargesSheet.addRow(row)
  }
  chargesSheet.addRow(['TOTAL CHARGES', roundEuros(incomeStatement.totalCharges)])
  chargesSheet.columns = [{ width: 60 }, { width: 18 }]

  // RESULTAT
  const resultSheet = workbook.addWorksheet('Résultat')
  resultSheet.addRow(['Libellé', 'Montant'])
  resultSheet.addRow(['Total produits', roundEuros(incomeStatement.totalProduits)])
  resultSheet.addRow(['Total charges', roundEuros(incomeStatement.totalCharges)])

  const intermediate = incomeStatement.intermediateResults
  if (intermediate) {
    if (intermediate.resultatExploitation !== undefined) {
      resultSheet.addRow(["Résultat d'exploitation", roundEuros(intermediate.resultatExploitation)])
    }
    if (intermediate.resultatFinancier !== undefined) {
      resultSheet.addRow(['Résultat financier', roundEuros(intermediate.resultatFinancier)])
    }
    if (intermediate.resultatCourant !== undefined) {
      resultSheet.addRow(['Résultat courant avant impôts', roundEuros(intermediate.resultatCourant)])
    }
    if (intermediate.resultatExceptionnel !== undefined) {
      resultSheet.addRow(['Résultat exceptionnel', roundEuros(intermediate.resultatExceptionnel)])
    }
  }

  resultSheet.addRow(['RÉSULTAT NET', roundEuros(incomeStatement.netResult)])
  resultSheet.columns = [{ width: 40 }, { width: 18 }]

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer as ArrayBuffer)
}
