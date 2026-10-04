/**
 * Budget against the books, per line and per month, in cents.
 *
 * - Actual amounts are the balances of the class 6 and 7 accounts over the
 *   validated entries of the fiscal year, closing entries excluded (the same
 *   totals as the compte de résultat, lib/reports/statements/load.ts):
 *   charges debit minus credit, produits credit minus debit (PCG art. 821-1).
 * - Every account goes to the line with the longest matching prefix
 *   (prefixes.ts); an account no line matches is listed as "hors budget"
 *   with a zero budget, so the totals of each side are those of the compte
 *   de résultat and the résultat is produits minus charges.
 * - Variance is actual minus budget. It is favorable when a charge stays
 *   under its budget or a produit (and the résultat) goes over it. The
 *   percentage is relative to the budget, null without a budget.
 * - Totals cover the months up to `throughMonth` (included), the whole year
 *   by default: halfway through the year, the year to date is compared with
 *   the budget of the same months. The annual budget is always given too.
 *
 * Pure: the service (budget-report.service.ts) loads the plan and the
 * account totals, this module only computes.
 */

import { matchPrefix, sideOfAccount, type BudgetSide } from './prefixes'
import type { MonthKey } from './months'

export interface PlannedLine {
  id: string
  accountPrefix: string
  label: string
  /** Planned cents per month, aligned with the report's months. */
  months: readonly number[]
}

export interface AccountActuals {
  code: string
  label: string
  /** Debit minus credit per month, in cents, aligned with the report's months. */
  debitBalances: readonly number[]
}

export interface Comparison {
  budgetCents: number
  actualCents: number
  /** Actual minus budget. */
  varianceCents: number
  /** Variance relative to the budget, in percent with one decimal; null without a budget. */
  variancePercent: number | null
  favorable: boolean
}

export interface MonthComparison {
  month: MonthKey
  budgetCents: number
  actualCents: number
  varianceCents: number
}

export interface ReportRow extends Comparison {
  /** Null for the accounts no line matches (hors budget). */
  lineId: string | null
  accountPrefix: string
  label: string
  /** Budget of the whole fiscal year, whatever `throughMonth`. */
  annualBudgetCents: number
  /** Accounts counted in this row, with their actual amount up to `throughMonth`. */
  accounts: Array<{ code: string; label: string; actualCents: number }>
  months: MonthComparison[]
}

export interface ReportTotal extends Comparison {
  annualBudgetCents: number
  months: MonthComparison[]
}

export interface ReportSection {
  side: BudgetSide
  lines: ReportRow[]
  /** Accounts with movements that no line matches, one row each. */
  unbudgeted: ReportRow[]
  total: ReportTotal
}

export interface BudgetComparison {
  months: MonthKey[]
  throughMonth: MonthKey
  charges: ReportSection
  produits: ReportSection
  /** Produits minus charges. */
  resultat: ReportTotal
}

/** Variance of `actual` against `budget` on one side (the résultat reads like produits). */
export function compare(side: BudgetSide | 'resultat', budgetCents: number, actualCents: number): Comparison {
  const varianceCents = actualCents - budgetCents
  const variancePercent = budgetCents === 0 ? null : Math.round((varianceCents / Math.abs(budgetCents)) * 1000) / 10
  const favorable = side === 'charges' ? varianceCents <= 0 : varianceCents >= 0
  return { budgetCents, actualCents, varianceCents, variancePercent, favorable }
}

const sum = (values: readonly number[]) => values.reduce((total, cents) => total + cents, 0)

function row(
  side: BudgetSide,
  months: readonly MonthKey[],
  through: number,
  base: { lineId: string | null; accountPrefix: string; label: string },
  budget: readonly number[],
  accounts: readonly AccountActuals[],
): ReportRow {
  // Charges read debit minus credit, produits credit minus debit (0 - x, never a -0).
  const signed = (cents: number) => (side === 'charges' ? cents : 0 - cents)
  const actual = months.map((_, i) => signed(sum(accounts.map((a) => a.debitBalances[i] ?? 0))))
  const upTo = (values: readonly number[]) => sum(values.slice(0, through + 1))
  return {
    ...base,
    ...compare(side, upTo(budget), upTo(actual)),
    annualBudgetCents: sum(budget),
    accounts: accounts.map((a) => ({ code: a.code, label: a.label, actualCents: signed(upTo(a.debitBalances)) })),
    months: months.map((month, i) => ({ month, budgetCents: budget[i] ?? 0, actualCents: actual[i], varianceCents: actual[i] - (budget[i] ?? 0) })),
  }
}

function total(side: BudgetSide | 'resultat', months: readonly MonthKey[], through: number, rows: ReadonlyArray<{ months: MonthComparison[]; annualBudgetCents: number }>, signs?: readonly number[]): ReportTotal {
  const factor = (i: number) => signs?.[i] ?? 1
  const perMonth = months.map((month, m) => {
    const budgetCents = sum(rows.map((r, i) => factor(i) * r.months[m].budgetCents))
    const actualCents = sum(rows.map((r, i) => factor(i) * r.months[m].actualCents))
    return { month, budgetCents, actualCents, varianceCents: actualCents - budgetCents }
  })
  const upTo = perMonth.slice(0, through + 1)
  return {
    ...compare(side, sum(upTo.map((m) => m.budgetCents)), sum(upTo.map((m) => m.actualCents))),
    annualBudgetCents: sum(rows.map((r, i) => factor(i) * r.annualBudgetCents)),
    months: perMonth,
  }
}

export function buildBudgetComparison(input: {
  months: readonly MonthKey[]
  /** Last month counted in the totals; the last month of the year when absent. */
  throughMonth?: MonthKey
  lines: readonly PlannedLine[]
  accounts: readonly AccountActuals[]
}): BudgetComparison {
  const { months, lines } = input
  const throughMonth = input.throughMonth ?? months[months.length - 1]
  const through = months.indexOf(throughMonth)
  if (through < 0) throw new RangeError(`Month ${throughMonth} is not in the fiscal year`)

  const prefixes = lines.map((l) => l.accountPrefix)
  const matched = new Map<string, AccountActuals[]>()
  const unmatched: AccountActuals[] = []
  for (const account of [...input.accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    if (sideOfAccount(account.code) === null) continue
    const prefix = matchPrefix(account.code, prefixes)
    if (prefix === null) unmatched.push(account)
    else matched.set(prefix, [...(matched.get(prefix) ?? []), account])
  }

  const section = (side: BudgetSide): ReportSection => {
    const sideLines = lines
      .filter((l) => sideOfAccount(l.accountPrefix) === side)
      .map((l) => row(side, months, through, { lineId: l.id, accountPrefix: l.accountPrefix, label: l.label }, l.months, matched.get(l.accountPrefix) ?? []))
    const unbudgeted = unmatched
      .filter((a) => sideOfAccount(a.code) === side && a.debitBalances.some((cents) => cents !== 0))
      .map((a) => row(side, months, through, { lineId: null, accountPrefix: a.code, label: a.label }, months.map(() => 0), [a]))
    return { side, lines: sideLines, unbudgeted, total: total(side, months, through, [...sideLines, ...unbudgeted]) }
  }

  const charges = section('charges')
  const produits = section('produits')
  return {
    months: [...months],
    throughMonth,
    charges,
    produits,
    resultat: total('resultat', months, through, [produits.total, charges.total], [1, -1]),
  }
}
