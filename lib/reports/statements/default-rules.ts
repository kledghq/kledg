/**
 * The default statement configurations as flat rule lists, the way
 * createDefaultBalanceSheetConfig / createDefaultIncomeStatementConfig store
 * them (section inherited from the parent, line type inferred when absent).
 * Used to check the default mapping without a database.
 */

import {
  COMPLETE_BALANCE_SHEET_CONFIG_2026,
  type DefaultBalanceSheetConfigEntry,
} from '../balance-sheet/config/default-pcg-config-complete-2026'
import { SIMPLIFIED_BALANCE_SHEET_CONFIG_2026 } from '../balance-sheet/config/default-pcg-config-simplified-2026'
import {
  COMPLETE_INCOME_STATEMENT_CONFIG_2026,
  type DefaultIncomeStatementConfigEntry,
} from '../income-statement/config/default-pcg-config-complete-2026'
import { SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026 } from '../income-statement/config/default-pcg-config-simplified-2026'
import type { BalanceSheetRule } from './balance-sheet'
import type { IncomeStatementRule } from './income-statement'

type Variant = 'complete' | 'simplified'

function lineTypeOf(entry: { lineType?: string; balanceType?: string; accountCodes?: string[] }) {
  if (entry.lineType) return entry.lineType
  if (entry.balanceType === 'auto') return 'sum'
  return (entry.accountCodes?.length ?? 0) === 0 ? 'group' : 'line'
}

export function defaultBalanceSheetRules(variant: Variant): BalanceSheetRule[] {
  return balanceSheetRulesFrom(
    variant === 'complete' ? COMPLETE_BALANCE_SHEET_CONFIG_2026 : SIMPLIFIED_BALANCE_SHEET_CONFIG_2026,
    variant
  )
}

/** Rules as createDefaultBalanceSheetConfig stores the given entries. */
export function balanceSheetRulesFrom(entries: DefaultBalanceSheetConfigEntry[], variant: Variant): BalanceSheetRule[] {
  const rules: BalanceSheetRule[] = []
  let n = 0
  const visit = (entry: DefaultBalanceSheetConfigEntry, parentId: string | null, parentSection: string | null) => {
    const id = `bs-${variant}-${n++}`
    const section = entry.section ?? parentSection
    rules.push({
      id,
      parentId,
      section,
      lineType: lineTypeOf(entry),
      lineLabel: entry.lineLabel,
      formCode: entry.formCode ?? null,
      accountCodes: entry.accountCodes ?? [],
      excludedAccountCodes: entry.excludedAccountCodes ?? [],
      amortissementAccountCodes: entry.amortissementAccountCodes ?? [],
      filterType: entry.filterType ?? null,
      balanceType: entry.balanceType ?? 'debit',
      displayType: entry.displayType ?? ((entry.amortissementAccountCodes?.length ?? 0) > 0 ? 'brut_amort_net' : 'net'),
      order: entry.order,
    })
    for (const child of entry.children ?? []) visit(child, id, section ?? null)
  }
  for (const entry of entries) visit(entry, null, null)
  return rules
}

export function defaultIncomeStatementRules(variant: Variant): IncomeStatementRule[] {
  return incomeStatementRulesFrom(
    variant === 'complete' ? COMPLETE_INCOME_STATEMENT_CONFIG_2026 : SIMPLIFIED_INCOME_STATEMENT_CONFIG_2026,
    variant
  )
}

/** Rules as createDefaultIncomeStatementConfig stores the given entries. */
export function incomeStatementRulesFrom(entries: DefaultIncomeStatementConfigEntry[], variant: Variant): IncomeStatementRule[] {
  const rules: IncomeStatementRule[] = []
  let n = 0
  const visit = (entry: DefaultIncomeStatementConfigEntry, parentId: string | null, parentSection: string | null) => {
    const id = `is-${variant}-${n++}`
    const section = entry.section ?? parentSection
    rules.push({
      id,
      parentId,
      section,
      lineType: lineTypeOf(entry),
      lineLabel: entry.lineLabel,
      formCode: entry.formCode ?? null,
      accountCodes: entry.accountCodes ?? [],
      excludedAccountCodes: entry.excludedAccountCodes ?? [],
      filterType: entry.filterType ?? null,
      balanceType: entry.balanceType ?? 'credit',
      order: entry.order,
    })
    for (const child of entry.children ?? []) visit(child, id, section ?? null)
  }
  for (const entry of entries) visit(entry, null, null)
  return rules
}
