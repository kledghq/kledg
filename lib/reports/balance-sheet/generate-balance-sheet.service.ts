/**
 * Generates the balance sheet of a fiscal year from the company's
 * configuration (see lib/reports/statements/balance-sheet.ts for the rules).
 */

import { getBalanceSheetConfig } from './config/get-balance-sheet-config.service'
import { getOrCreateDefaultBalanceSheetConfig } from './config/create-default-pcg-config.service'
import { buildBalanceSheet, type BalanceSheetRule } from '../statements/balance-sheet'
import { findUnbalancedEntries, loadFiscalYearOf, loadStatementAccounts } from '../statements/load'
import type { BalanceSheetData } from './types'
import { upgradeLayoutIfUntouched } from '../statements/layout-upgrade'
import { parseStatementRules } from '../config/shared/config-schema'

/**
 * Generates the balance sheet of a fiscal year.
 *
 * The closing entries of the year (journal CL) are always excluded: the
 * balance sheet of a closed year shows its real result on the "Résultat de
 * l'exercice" line and the balances before the closing entry.
 *
 * @param companyId - Company ID
 * @param fiscalYearId - Fiscal year ID
 * @param reportVariant - 'complete' | 'simplified'
 */
export async function generateBalanceSheet(
  companyId: string,
  fiscalYearId: string,
  reportVariant: 'complete' | 'simplified' = 'complete'
): Promise<BalanceSheetData> {
  const fiscalYear = await loadFiscalYearOf(companyId, fiscalYearId)

  const layoutStatus = await upgradeLayoutIfUntouched(companyId, 'balance-sheet', reportVariant)
  let config = await getBalanceSheetConfig(companyId, reportVariant)
  if (config.lines.length === 0) {
    await getOrCreateDefaultBalanceSheetConfig(companyId, reportVariant)
    config = await getBalanceSheetConfig(companyId, reportVariant)
  }

  const accounts = await loadStatementAccounts(companyId, fiscalYear)
  const balanceSheet = buildBalanceSheet({
    companyId,
    fiscalYearId,
    reportVariant,
    rules: parseStatementRules<BalanceSheetRule>(config.lines, 'du bilan', { companyId, reportVariant }),
    accounts,
  })

  if (balanceSheet.diagnostic && balanceSheet.imbalance !== undefined) {
    balanceSheet.diagnostic.causes.unbalancedEntries = await findUnbalancedEntries(companyId, fiscalYearId)
  }
  return { ...balanceSheet, layoutStatus: layoutStatus === 'empty' ? 'default' : layoutStatus }
}
