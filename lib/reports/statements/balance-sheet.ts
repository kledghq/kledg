/**
 * Builds the balance sheet (bilan) from account balances and a line
 * configuration. Pure: no database access.
 *
 * - Every class 1 to 5 account with a balance is allocated to exactly one
 *   line (see allocation.ts).
 * - The "Résultat de l'exercice" line (form code DI on 2051, 136 on 2033-A,
 *   accounts 12) receives the result of the year computed from classes 6
 *   and 7, plus any balance left in the 12 accounts (a previous result not
 *   yet allocated). The closing entries of the year (journal CL) must be
 *   excluded from `accounts`: the statements of a year are drawn up before
 *   its closing entry (PCG art. 821-1 and 821-3: the result of the income
 *   statement is the result shown in the balance sheet).
 * - Totals are sums of the lines: Actif = Passif holds by construction when
 *   the ledger is balanced and every account is mapped; otherwise the
 *   difference is returned with its causes.
 */

import type { AccountBalance } from '../types'
import type {
  BalanceSheetData,
  BalanceSheetLine,
  BalanceSheetLineConfig,
  BalanceSheetSection,
  ImbalanceDiagnostic,
} from '../balance-sheet/types'
import { formatCentsFr, fromCents, toCents } from '@/lib/utils/money'
import {
  allocateAccounts,
  contribution,
  leafRules,
  sectionOf,
  type AccountTotals,
  type StatementLineRule,
} from './allocation'
import { plural, pluralWord } from '@/lib/utils/plural'

/** Form codes of the "Résultat de l'exercice" line (2050-2051: DI, 2033-A: 136). */
const RESULT_FORM_CODES = ['DI', '136']

export type BalanceSheetRule = StatementLineRule &
  Partial<Pick<BalanceSheetLineConfig, 'hideLabel' | 'notes' | 'amortissementFormCode'>> & {
    lineLabel: string
    children?: BalanceSheetRule[]
  }

export interface BuildBalanceSheetInput {
  companyId: string
  fiscalYearId: string
  reportVariant: 'complete' | 'simplified'
  rules: BalanceSheetRule[]
  /** Balances of every account of the year, closing entries excluded. */
  accounts: AccountTotals[]
}

/** Flattens a configuration tree (children arrays) into a list with parentId set. */
export function flattenRules<T extends { id: string; parentId?: string | null; children?: T[] }>(
  rules: T[]
): T[] {
  const out: T[] = []
  const visit = (rule: T, parentId: string | null) => {
    out.push({ ...rule, parentId: rule.parentId ?? parentId })
    for (const child of rule.children ?? []) visit(child, rule.id)
  }
  for (const rule of rules) visit(rule, null)
  // A flat list (no children arrays) is returned as is.
  const seen = new Set<string>()
  return out.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })
}

const classOf = (code: string) => code.charAt(0)

/** Result of the year from classes 6 and 7 (products - charges), in cents. */
export function resultCents(accounts: AccountTotals[]): number {
  return accounts
    .filter((a) => classOf(a.code) === '6' || classOf(a.code) === '7')
    .reduce((sum, a) => sum + a.creditCents - a.debitCents, 0)
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

/** The leaf that receives the year's result. */
function findResultRule<T extends StatementLineRule>(leaves: T[]): T | undefined {
  return (
    leaves.find((r) => r.formCode && RESULT_FORM_CODES.includes(r.formCode)) ??
    leaves.find((r) => r.accountCodes.includes('12'))
  )
}

interface LineCents {
  main: number
  amort: number
  accounts: AccountTotals[]
}

export function buildBalanceSheet(input: BuildBalanceSheetInput): BalanceSheetData & {
  netResult: number
  warnings: string[]
} {
  const rules = flattenRules(input.rules)
  const byId = new Map<string, BalanceSheetRule>(rules.map((r) => [r.id, r]))
  const leaves = leafRules(rules)

  const bsAccounts = input.accounts.filter((a) => '12345'.includes(classOf(a.code)) && a.code !== '')
  const outside = input.accounts.filter(
    (a) => !'1234567'.includes(classOf(a.code)) && a.debitCents !== a.creditCents
  )
  const yearResult = resultCents(input.accounts)

  const allocation = allocateAccounts(rules, bsAccounts, 'balance-sheet')
  const cents = new Map<string, LineCents>()
  for (const leaf of leaves) cents.set(leaf.id, { main: 0, amort: 0, accounts: [] })
  for (const a of allocation.allocations) {
    const line = cents.get(a.lineId)!
    const value = contribution(a, sectionOf(byId.get(a.lineId)!, byId, 'balance-sheet'))
    if (a.slot === 'amortissement') line.amort += value
    else line.main += value
    line.accounts.push(a.account)
  }

  const resultRule = findResultRule(leaves)
  if (resultRule) cents.get(resultRule.id)!.main += yearResult

  // Tree
  const childrenOf = new Map<string, BalanceSheetRule[]>()
  for (const rule of rules) {
    if (rule.parentId && byId.has(rule.parentId)) {
      const list = childrenOf.get(rule.parentId) ?? []
      list.push(rule)
      childrenOf.set(rule.parentId, list)
    }
  }
  const byOrder = (a: BalanceSheetRule, b: BalanceSheetRule) => a.order - b.order

  // Each built line carries its cents so parent lines sum cents, not euros.
  type Built = { line: BalanceSheetLine; netCents: number; brutCents: number; amortCents: number; hasBrut: boolean }
  const build = (rule: BalanceSheetRule, seen: Set<string>): Built => {
    seen.add(rule.id)
    const children = (childrenOf.get(rule.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort(byOrder)
      .map((c) => build(c, seen))
    const base = {
      id: rule.id,
      lineLabel: rule.lineLabel,
      formCode: rule.formCode ?? undefined,
      hideLabel: rule.hideLabel ?? false,
      order: rule.order,
      notes: rule.notes ?? undefined,
    }
    const isTotal = rule.lineLabel.toLowerCase().includes('total')

    if (children.length > 0) {
      const netCents = children.reduce((s, c) => s + c.netCents, 0)
      // A child without columns counts its net as brut and no depreciation
      const brutCents = children.reduce((s, c) => s + c.brutCents, 0)
      const amortCents = children.reduce((s, c) => s + c.amortCents, 0)
      const withBrut = !isTotal && children.some((c) => c.hasBrut)
      return {
        line: {
          ...base,
          value: fromCents(netCents),
          net: fromCents(netCents),
          brut: withBrut ? fromCents(brutCents) : undefined,
          amortissements: withBrut ? fromCents(amortCents) : undefined,
          accounts: children.flatMap((c) => c.line.accounts),
          children: children.map((c) => c.line),
        },
        netCents,
        brutCents: withBrut ? brutCents : netCents,
        amortCents: withBrut ? amortCents : 0,
        hasBrut: withBrut,
      }
    }

    const values = cents.get(rule.id) ?? { main: 0, amort: 0, accounts: [] }
    const netCents = values.main - values.amort
    const showColumns = rule.displayType === 'brut_amort_net' && sectionOf(rule, byId, 'balance-sheet') === 'actif'
    return {
      line: {
        ...base,
        value: fromCents(netCents),
        net: fromCents(netCents),
        brut: showColumns ? fromCents(values.main) : undefined,
        amortissements: showColumns ? fromCents(values.amort) : undefined,
        accounts: values.accounts.map(toAccountBalance),
        children: [],
      },
      netCents,
      brutCents: showColumns ? values.main : netCents,
      amortCents: showColumns ? values.amort : 0,
      hasBrut: showColumns,
    }
  }

  const seen = new Set<string>()
  const roots = rules.filter((r) => !r.parentId || !byId.has(r.parentId)).sort(byOrder)
  const actifLines: BalanceSheetLine[] = []
  const passifLines: BalanceSheetLine[] = []
  for (const root of roots) {
    const { line } = build(root, seen)
    if (sectionOf(root, byId, 'balance-sheet') === 'passif') passifLines.push(line)
    else actifLines.push(line)
  }

  // Totals from cents (no floating point drift).
  let actifCents = 0
  let passifCents = 0
  let brutCents = 0
  let amortCents = 0
  for (const leaf of leaves) {
    const values = cents.get(leaf.id)!
    if (sectionOf(leaf, byId, 'balance-sheet') === 'passif') {
      passifCents += values.main - values.amort
    } else {
      actifCents += values.main - values.amort
      brutCents += values.main
      amortCents += values.amort
    }
  }

  const actif: BalanceSheetSection = {
    label: 'ACTIF',
    lines: actifLines,
    total: fromCents(actifCents),
    netTotal: fromCents(actifCents),
    brutTotal: fromCents(brutCents),
    amortissementsTotal: fromCents(amortCents),
  }
  const passif: BalanceSheetSection = {
    label: 'PASSIF',
    lines: passifLines,
    total: fromCents(passifCents),
    netTotal: fromCents(passifCents),
  }

  const imbalanceCents = actifCents - passifCents
  const warnings: string[] = []
  const configurationIssues: ImbalanceDiagnostic['causes']['configurationIssues'] = []
  if (!resultRule) {
    configurationIssues.push({
      lineId: '',
      issue: "Aucune ligne « Résultat de l'exercice » (comptes 12) dans la configuration du bilan.",
      suggestion: 'Rétablissez la configuration par défaut du bilan.',
    })
  }
  for (const a of allocation.ambiguous) {
    configurationIssues.push({
      lineId: a.lineIds[0],
      issue: `Le compte ${a.code} correspond à plusieurs lignes (${a.lineIds
        .map((id) => byId.get(id)?.lineLabel ?? id)
        .join(', ')}) : il n'est compté que dans la première.`,
      suggestion: 'Retirez ce compte de toutes les lignes sauf une.',
    })
  }
  const unmappedAccounts = allocation.unmapped.map((a) => ({
    accountId: a.accountId ?? a.code,
    code: a.code,
    label: a.label ?? '',
    balance: fromCents(a.debitCents - a.creditCents),
    suggestion: `Rattachez le compte ${a.code} à une ligne du bilan.`,
  }))
  for (const a of outside) {
    warnings.push(
      `Le compte ${a.code} (classe ${classOf(a.code)}) a un solde de ${formatCentsFr(
        a.debitCents - a.creditCents
      )} : il ne figure ni au bilan ni au compte de résultat.`
    )
  }
  if (unmappedAccounts.length > 0) {
    warnings.push(
      `${plural(unmappedAccounts.length, 'compte')} ${pluralWord(unmappedAccounts.length, "n'est rattaché", 'ne sont rattachés')} à aucune ligne du bilan : ${unmappedAccounts
        .map((a) => a.code)
        .join(', ')}. Rattachez-les à une ligne ou rétablissez la configuration par défaut (bouton Configuration).`
    )
  }

  const hasIssues =
    imbalanceCents !== 0 || unmappedAccounts.length > 0 || configurationIssues.length > 0
  const diagnostic: ImbalanceDiagnostic | undefined = hasIssues
    ? {
        imbalance: fromCents(imbalanceCents),
        severity: imbalanceCents !== 0 ? 'error' : 'warning',
        causes: { unbalancedEntries: [], unmappedAccounts, configurationIssues },
        suggestions: warnings,
      }
    : undefined

  return {
    companyId: input.companyId,
    fiscalYearId: input.fiscalYearId,
    reportVariant: input.reportVariant,
    actif,
    passif,
    actifTotal: fromCents(actifCents),
    passifTotal: fromCents(passifCents),
    imbalance: imbalanceCents !== 0 ? fromCents(imbalanceCents) : undefined,
    diagnostic,
    netResult: fromCents(yearResult),
    warnings,
    generatedAt: new Date(),
  }
}

/** Actif = Passif to the cent, with a French message otherwise. */
export function validateBalanceSheetBalance(balanceSheet: Pick<BalanceSheetData, 'actifTotal' | 'passifTotal'>): {
  isValid: boolean
  imbalance?: number
  error?: string
} {
  // Report totals are euros computed from cents: back to cents, exactly
  const actifCents = toCents(balanceSheet.actifTotal) ?? 0
  const passifCents = toCents(balanceSheet.passifTotal) ?? 0
  const imbalanceCents = actifCents - passifCents
  if (imbalanceCents === 0) return { isValid: true }
  return {
    isValid: false,
    imbalance: fromCents(imbalanceCents),
    error: `Le bilan n'est pas équilibré : écart de ${formatCentsFr(imbalanceCents)} (Actif : ${formatCentsFr(actifCents)}, Passif : ${formatCentsFr(passifCents)})`,
  }
}
