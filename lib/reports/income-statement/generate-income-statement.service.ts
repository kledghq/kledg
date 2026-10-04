/**
 * Generates the income statement of a fiscal year from the company's
 * configuration (see lib/reports/statements/income-statement.ts for the rules).
 */

import { getIncomeStatementConfig } from './config/get-income-statement-config.service'
import { buildIncomeStatement, type IncomeStatementRule } from '../statements/income-statement'
import { loadFiscalYearOf, loadStatementAccounts } from '../statements/load'
import type { IncomeStatementData } from './types'
import { upgradeLayoutIfUntouched } from '../statements/layout-upgrade'

/**
 * Generates the income statement of a fiscal year.
 *
 * The closing entries of the year (journal CL) are always excluded: the
 * income statement of a closed year shows its real result.
 */
export async function generateIncomeStatement(
  companyId: string,
  fiscalYearId: string,
  reportVariant: 'complete' | 'simplified' = 'complete'
): Promise<IncomeStatementData> {
  const fiscalYear = await loadFiscalYearOf(companyId, fiscalYearId)
  const layoutStatus = await upgradeLayoutIfUntouched(companyId, 'income-statement', reportVariant)
  const config = await getIncomeStatementConfig(companyId, reportVariant)
  const accounts = await loadStatementAccounts(companyId, fiscalYear)
  const statement = buildIncomeStatement({
    companyId,
    fiscalYearId,
    reportVariant,
    rules: config.lines as unknown as IncomeStatementRule[],
    accounts,
  })
  return { ...statement, layoutStatus: layoutStatus === 'empty' ? 'default' : layoutStatus }
}
