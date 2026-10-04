/**
 * Generates balance sheet comparison between two fiscal years (N vs N-1)
 */

import { generateBalanceSheet } from './generate-balance-sheet.service'
import type { BalanceSheetComparison, BalanceSheetData, BalanceSheetLine } from './types'
import { subtractEuros } from '../amounts'
import { loadFiscalYearOf } from '../statements/load'

/** Net amount of every line of the tree, by line id. */
function netByLine(lines: BalanceSheetLine[], into = new Map<string, number>()): Map<string, number> {
  for (const line of lines) {
    into.set(line.id, line.net)
    if (line.children) netByLine(line.children, into)
  }
  return into
}

/**
 * Generates balance sheet comparison
 * 
 * @param companyId - Company ID
 * @param currentFiscalYearId - Current fiscal year ID
 * @param previousFiscalYearId - Previous fiscal year ID
 * @param reportVariant - 'complete' | 'simplified'
 * @returns Comparison data with variations
 */
export async function generateBalanceSheetComparison(
  companyId: string,
  currentFiscalYearId: string,
  previousFiscalYearId: string,
  reportVariant: 'complete' | 'simplified' = 'complete'
): Promise<BalanceSheetComparison> {
  // Both years first: a 404 on one of them must not leave the other balance
  // sheet running (and creating the default layout) after this call failed.
  await loadFiscalYearOf(companyId, currentFiscalYearId)
  await loadFiscalYearOf(companyId, previousFiscalYearId)

  // Generate both balance sheets
  const [current, previous] = await Promise.all([
    generateBalanceSheet(companyId, currentFiscalYearId, reportVariant),
    generateBalanceSheet(companyId, previousFiscalYearId, reportVariant),
  ])

  // Calculate variations
  const actifVariation = subtractEuros(current.actifTotal, previous.actifTotal)
  const actifVariationPercent =
    previous.actifTotal !== 0
      ? (actifVariation / previous.actifTotal) * 100
      : 0

  const passifVariation = subtractEuros(current.passifTotal, previous.passifTotal)
  const passifVariationPercent =
    previous.passifTotal !== 0
      ? (passifVariation / previous.passifTotal) * 100
      : 0

  // Calculate line variations
  const lineVariations = new Map<string, {
    absolute: number
    percent: number
    isSignificant: boolean
  }>()

  function calculateLineVariations(
    currentLines: BalanceSheetData['actif']['lines'],
    previousLines: BalanceSheetData['actif']['lines']
  ) {
    const currentMap = netByLine(currentLines)
    const previousMap = netByLine(previousLines)

    for (const [lineId, currentValue] of currentMap.entries()) {
      const previousValue = previousMap.get(lineId) || 0
      const absolute = subtractEuros(currentValue, previousValue)
      const percent = previousValue !== 0 ? (absolute / previousValue) * 100 : 0
      const isSignificant = Math.abs(percent) > 10 || Math.abs(absolute) > 1000

      lineVariations.set(lineId, {
        absolute,
        percent,
        isSignificant,
      })
    }
  }

  calculateLineVariations(current.actif.lines, previous.actif.lines)
  calculateLineVariations(current.passif.lines, previous.passif.lines)

  return {
    current,
    previous,
    variations: {
      actifVariation,
      actifVariationPercent,
      passifVariation,
      passifVariationPercent,
      lineVariations,
    },
  }
}
