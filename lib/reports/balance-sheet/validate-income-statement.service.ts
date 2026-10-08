/**
 * Checks that the balance sheet carries the result of the income statement
 * (PCG art. 821-1 and 821-3): the result included in the "Résultat de
 * l'exercice" line is the net result of the income statement. Both are
 * computed without the year's closing entries.
 */

import { generateBalanceSheet } from './generate-balance-sheet.service'
import { generateIncomeStatement } from '../income-statement/generate-income-statement.service'
import { formatCentsFr, fromCents, toCents } from '@/lib/utils/money'

export interface BalanceSheetIncomeStatementValidation {
  balanceSheetResult: number // Result of the year included in the balance sheet
  incomeStatementResult: number // Net result of the income statement
  matches: boolean
  difference: number
  errors: string[]
  warnings: string[]
}

export async function validateBalanceSheetAgainstIncomeStatement(
  companyId: string,
  fiscalYearId: string,
  reportVariant: 'complete' | 'simplified' = 'complete'
): Promise<BalanceSheetIncomeStatementValidation> {
  const [balanceSheet, incomeStatement] = await Promise.all([
    generateBalanceSheet(companyId, fiscalYearId, reportVariant),
    generateIncomeStatement(companyId, fiscalYearId, reportVariant),
  ])
  const balanceSheetResult = balanceSheet.netResult ?? 0
  const incomeStatementResult = incomeStatement.netResult
  // Both results are euros computed from cents: compare them back in cents
  const balanceSheetCents = toCents(balanceSheetResult) ?? 0
  const incomeStatementCents = toCents(incomeStatementResult) ?? 0
  const differenceCents = balanceSheetCents - incomeStatementCents
  const difference = fromCents(differenceCents)
  const matches = differenceCents === 0 && balanceSheet.imbalance === undefined

  const errors: string[] = []
  if (differenceCents !== 0) {
    errors.push(
      `Le résultat du bilan (${formatCentsFr(balanceSheetCents)}) ne correspond pas au résultat du compte de résultat (${formatCentsFr(incomeStatementCents)}). Écart : ${formatCentsFr(differenceCents)}`
    )
  }
  if (balanceSheet.imbalance !== undefined) {
    errors.push(`Le bilan n'est pas équilibré : écart de ${formatCentsFr(toCents(balanceSheet.imbalance) ?? 0)}`)
  }

  return {
    balanceSheetResult,
    incomeStatementResult,
    matches,
    difference,
    errors,
    warnings: [...(balanceSheet.warnings ?? []), ...(incomeStatement.warnings ?? [])],
  }
}
