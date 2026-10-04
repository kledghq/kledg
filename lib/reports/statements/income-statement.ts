/**
 * Builds the income statement (compte de résultat) from account balances and
 * a line configuration. Pure: no database access.
 *
 * - Every class 6 and 7 account with a balance is allocated to exactly one
 *   line (see allocation.ts). Charges count debit - credit, products credit
 *   - debit, so rebates and reversals reduce their line.
 * - A line with children is the sum of its children.
 * - The intermediate results of the official models (résultat
 *   d'exploitation, financier, courant, exceptionnel, bénéfice ou perte) are
 *   lines without accounts or children, identified by their form code and
 *   computed from the other lines (forms 2052 and 2033-B). They are not part
 *   of the totals.
 * - Total produits - total charges is the net result; with every account
 *   mapped it equals the result of classes 6 and 7 used by the balance sheet
 *   (PCG art. 821-3 and 821-1).
 *
 * The closing entries of the year (journal CL) must be excluded from
 * `accounts`: they bring 6 and 7 to zero.
 */

import type { AccountBalance } from '../types'
import type {
  IncomeStatementData,
  IncomeStatementLine,
  IncomeStatementLineConfig,
  IncomeStatementSection,
} from '../income-statement/types'
import { fromCents } from '@/lib/utils/money'
import {
  allocateAccounts,
  contribution,
  leafRules,
  sectionOf,
  type AccountTotals,
  type StatementLineRule,
} from './allocation'
import { flattenRules } from './balance-sheet'
import { plural, pluralWord } from '@/lib/utils/plural'

export type IncomeStatementRule = StatementLineRule &
  Partial<Pick<IncomeStatementLineConfig, 'hideLabel' | 'notes'>> & {
    lineLabel: string
    children?: IncomeStatementRule[]
  }

type Operand = { code: string; sign: 1 | -1 }
const TOTAL_PRODUITS = '__TOTAL_PRODUITS__'
const TOTAL_CHARGES = '__TOTAL_CHARGES__'
const plus = (code: string): Operand => ({ code, sign: 1 })
const minus = (code: string): Operand => ({ code, sign: -1 })

/**
 * Intermediate results by form code, as differences of other lines.
 * 2052: GG = FR - GF, GV = GP - GU, GW = GG + GH - GI + GV, HI = HD - HH,
 * HL / HM = totals, HN = HL - HM.
 * 2033-B style simplified model: 270 = 232 - 264, GV = 280 - 294,
 * GW = 270 + GH - GI + GV, HI = 290 - 300, 310 = produits - charges.
 */
export const RESULT_FORMULAS: Record<string, Operand[]> = {
  GG: [plus('FR'), minus('GF')],
  GV: [plus('GP'), minus('GU'), plus('280'), minus('294')],
  GW: [plus('GG'), plus('270'), plus('GH'), minus('GI'), plus('GV')],
  HI: [plus('HD'), minus('HH'), plus('290'), minus('300')],
  HL: [plus(TOTAL_PRODUITS)],
  HM: [plus(TOTAL_CHARGES)],
  HN: [plus(TOTAL_PRODUITS), minus(TOTAL_CHARGES)],
  '270': [plus('232'), minus('264')],
  '310': [plus(TOTAL_PRODUITS), minus(TOTAL_CHARGES)],
}

export interface BuildIncomeStatementInput {
  companyId: string
  fiscalYearId: string
  reportVariant: 'complete' | 'simplified'
  rules: IncomeStatementRule[]
  /** Balances of every account of the year, closing entries excluded. */
  accounts: AccountTotals[]
}

function toAccountBalance(a: AccountTotals): AccountBalance {
  return {
    accountId: a.accountId ?? a.code,
    code: a.code,
    label: a.label ?? '',
    debit: fromCents(a.debitCents),
    credit: fromCents(a.creditCents),
    balance: fromCents(a.debitCents - a.creditCents),
  }
}

export function buildIncomeStatement(input: BuildIncomeStatementInput): IncomeStatementData & {
  warnings: string[]
  unmappedAccounts: AccountBalance[]
} {
  const rules = flattenRules(input.rules)
  const byId = new Map<string, IncomeStatementRule>(rules.map((r) => [r.id, r]))
  const leaves = leafRules(rules)
  const isAccounts = input.accounts.filter((a) => a.code.startsWith('6') || a.code.startsWith('7'))
  const allocation = allocateAccounts(rules, isAccounts, 'income-statement')

  const leafCents = new Map<string, { value: number; accounts: AccountTotals[] }>()
  for (const leaf of leaves) leafCents.set(leaf.id, { value: 0, accounts: [] })
  let produitsCents = 0
  let chargesCents = 0
  for (const a of allocation.allocations) {
    const section = sectionOf(byId.get(a.lineId)!, byId, 'income-statement')
    const value = contribution(a, section)
    const line = leafCents.get(a.lineId)!
    line.value += value
    line.accounts.push(a.account)
    if (section === 'charges') chargesCents += value
    else produitsCents += value
  }

  const childrenOf = new Map<string, IncomeStatementRule[]>()
  for (const rule of rules) {
    if (rule.parentId && byId.has(rule.parentId)) {
      const list = childrenOf.get(rule.parentId) ?? []
      list.push(rule)
      childrenOf.set(rule.parentId, list)
    }
  }
  const leafIds = new Set(leaves.map((l) => l.id))
  const isFormula = (rule: IncomeStatementRule) =>
    !leafIds.has(rule.id) &&
    (childrenOf.get(rule.id)?.length ?? 0) === 0 &&
    !!rule.formCode &&
    rule.formCode in RESULT_FORMULAS

  // Values in cents of every non-formula line (sums bottom-up).
  const valueCents = new Map<string, number>()
  const computeValue = (rule: IncomeStatementRule, seen: Set<string>): number => {
    if (valueCents.has(rule.id)) return valueCents.get(rule.id)!
    if (seen.has(rule.id)) return 0
    seen.add(rule.id)
    let value = 0
    if (leafCents.has(rule.id)) value = leafCents.get(rule.id)!.value
    else
      for (const child of childrenOf.get(rule.id) ?? []) {
        if (!isFormula(child)) value += computeValue(child, seen)
      }
    valueCents.set(rule.id, value)
    return value
  }
  for (const rule of rules) if (!isFormula(rule)) computeValue(rule, new Set())

  // Intermediate results: an operand is the first non-formula line with that
  // form code (preferring a sum over a leaf of the same code), or a formula
  // line computed before it.
  const byFormCode = new Map<string, number>()
  for (const rule of [...rules].sort((a, b) => Number(leafIds.has(a.id)) - Number(leafIds.has(b.id)))) {
    if (rule.formCode && !isFormula(rule) && !byFormCode.has(rule.formCode)) {
      byFormCode.set(rule.formCode, valueCents.get(rule.id) ?? 0)
    }
  }
  byFormCode.set(TOTAL_PRODUITS, produitsCents)
  byFormCode.set(TOTAL_CHARGES, chargesCents)
  // Every intermediate result whose operands exist in this model, dependencies
  // first (GW uses GG or 270, and GV). A line of the model with that form
  // code and children or accounts keeps its own value.
  const formulaOrder = ['GG', '270', 'GV', 'GW', 'HI', 'HL', 'HM', 'HN', '310']
  for (const code of formulaOrder) {
    if (byFormCode.has(code)) continue
    const operands = RESULT_FORMULAS[code].filter((op) => byFormCode.has(op.code))
    if (operands.length === 0) continue
    byFormCode.set(
      code,
      operands.reduce((sum, op) => sum + op.sign * byFormCode.get(op.code)!, 0)
    )
  }
  for (const rule of rules.filter(isFormula)) {
    valueCents.set(rule.id, byFormCode.get(rule.formCode!) ?? 0)
  }

  const byOrder = (a: IncomeStatementRule, b: IncomeStatementRule) => a.order - b.order
  const build = (rule: IncomeStatementRule, seen: Set<string>): IncomeStatementLine => {
    seen.add(rule.id)
    const children = (childrenOf.get(rule.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort(byOrder)
      .map((c) => build(c, seen))
    return {
      id: rule.id,
      lineLabel: rule.lineLabel,
      formCode: rule.formCode ?? undefined,
      value: fromCents(valueCents.get(rule.id) ?? 0),
      accounts: (leafCents.get(rule.id)?.accounts ?? []).map(toAccountBalance),
      children,
      hideLabel: rule.hideLabel ?? false,
      order: rule.order,
      notes: rule.notes ?? undefined,
    }
  }

  const seen = new Set<string>()
  const produitsLines: IncomeStatementLine[] = []
  const chargesLines: IncomeStatementLine[] = []
  for (const root of rules.filter((r) => !r.parentId || !byId.has(r.parentId)).sort(byOrder)) {
    const line = build(root, seen)
    if (sectionOf(root, byId, 'income-statement') === 'charges') chargesLines.push(line)
    else produitsLines.push(line)
  }

  const produits: IncomeStatementSection = { label: 'Produits', lines: produitsLines, total: fromCents(produitsCents) }
  const charges: IncomeStatementSection = { label: 'Charges', lines: chargesLines, total: fromCents(chargesCents) }

  const warnings: string[] = []
  const unmappedAccounts = allocation.unmapped.map(toAccountBalance)
  if (unmappedAccounts.length > 0) {
    warnings.push(
      `${plural(unmappedAccounts.length, 'compte')} ${pluralWord(unmappedAccounts.length, "n'est rattaché", 'ne sont rattachés')} à aucune ligne du compte de résultat : ${unmappedAccounts
        .map((a) => a.code)
        .join(', ')}. Rattachez-les à une ligne ou rétablissez la configuration par défaut (bouton Configuration).`
    )
  }
  for (const a of allocation.ambiguous) {
    warnings.push(
      `Le compte ${a.code} correspond à plusieurs lignes (${a.lineIds
        .map((id) => byId.get(id)?.lineLabel ?? id)
        .join(', ')}) : il n'est compté que dans la première.`
    )
  }

  const intermediate = (code: string) => (byFormCode.has(code) ? fromCents(byFormCode.get(code)!) : undefined)
  return {
    companyId: input.companyId,
    fiscalYearId: input.fiscalYearId,
    reportVariant: input.reportVariant,
    produits,
    charges,
    totalProduits: fromCents(produitsCents),
    totalCharges: fromCents(chargesCents),
    netResult: fromCents(produitsCents - chargesCents),
    intermediateResults: {
      resultatExploitation: intermediate('GG') ?? intermediate('270'),
      resultatFinancier: intermediate('GV'),
      resultatCourant: intermediate('GW'),
      resultatExceptionnel: intermediate('HI'),
    },
    warnings,
    unmappedAccounts,
    generatedAt: new Date(),
  }
}
