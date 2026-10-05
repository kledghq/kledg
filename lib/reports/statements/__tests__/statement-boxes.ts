/**
 * Test helper: the box of the official model where an account lands, for
 * each default layout. The box of a line is its own form code, or the code
 * of its closest ancestor that has one (a detail line without a box adds up
 * into its parent's box); the depreciation column uses the amortissements
 * code. A balance shown against its usual side (a debit report à nouveau in
 * the capitaux propres) is marked " (-)".
 */

import { allocateAccounts, type StatementLineRule } from '../allocation'
import { flattenRules } from '../balance-sheet'
import { defaultBalanceSheetRules, defaultIncomeStatementRules } from '../default-rules'

type Rule = StatementLineRule & { amortissementFormCode?: string | null }
const VARIANTS = ['complete', 'simplified'] as const

const layouts = {
  bs: Object.fromEntries(VARIANTS.map((v) => [v, flattenRules(defaultBalanceSheetRules(v)) as Rule[]])) as Record<(typeof VARIANTS)[number], Rule[]>,
  is: Object.fromEntries(VARIANTS.map((v) => [v, flattenRules(defaultIncomeStatementRules(v)) as Rule[]])) as Record<(typeof VARIANTS)[number], Rule[]>,
}

function boxOfRule(rules: Rule[], id: string, column: 'main' | 'amortissement'): string {
  const byId = new Map(rules.map((r) => [r.id, r]))
  let current = byId.get(id)
  while (current) {
    const code = column === 'amortissement' ? current.amortissementFormCode : current.formCode
    if (code) return code
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return 'NO BOX'
}

function place(kind: 'bs' | 'is', variant: (typeof VARIANTS)[number], code: string, debit: boolean): string {
  const rules = layouts[kind][variant]
  const result = allocateAccounts(rules, [{ code, debitCents: debit ? 100 : 0, creditCents: debit ? 0 : 100 }], kind === 'bs' ? 'balance-sheet' : 'income-statement')
  if (result.unmapped.length > 0) return 'UNMAPPED'
  if (result.ambiguous.length > 0) return 'AMBIGUOUS'
  const allocation = result.allocations[0]
  return boxOfRule(rules, allocation.lineId, allocation.slot) + (allocation.againstSign ? ' (-)' : '')
}

/**
 * Balance sheet accounts: [2050/2051 debit, 2050/2051 credit, 2033-A debit,
 * 2033-A credit]. Income statement accounts: [2052/2053, 2033-B].
 */
export function boxesOf(code: string): string[] {
  if (/^[1-5]/.test(code)) {
    return VARIANTS.flatMap((v) => [place('bs', v, code, true), place('bs', v, code, false)])
  }
  return VARIANTS.map((v) => place('is', v, code, true))
}
