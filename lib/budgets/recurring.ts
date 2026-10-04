/**
 * Recurring budget items (a subscription, a rent, an insurance premium):
 * an amount that falls due every month, every quarter or every year from a
 * first month, until an optional last month. They are expanded into the
 * months of the fiscal year and added to the amounts entered by month.
 *
 * The first month anchors the rhythm: a quarterly item starting in
 * November 2025 falls due in February, May, August and November 2026, so a
 * premium paid on its own calendar keeps it from year to year.
 *
 * Pure (imports months.ts only): usable on both sides.
 */

import { monthIndex, type MonthKey } from './months'

export const BUDGET_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'YEARLY'] as const
export type BudgetFrequency = (typeof BUDGET_FREQUENCIES)[number]

/** Months between two due dates. */
const STEP: Record<BudgetFrequency, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 }

export const FREQUENCY_LABELS: Record<BudgetFrequency, string> = {
  MONTHLY: 'Mensuel',
  QUARTERLY: 'Trimestriel',
  YEARLY: 'Annuel',
}

export interface RecurringItem {
  amountCents: number
  frequency: BudgetFrequency
  startMonth: MonthKey
  /** Last month the item may fall due (included); null: no end. */
  endMonth: MonthKey | null
}

/** Whether the item falls due in `month`. */
export function fallsDueIn(item: RecurringItem, month: MonthKey): boolean {
  const offset = monthIndex(month) - monthIndex(item.startMonth)
  if (offset < 0) return false
  if (item.endMonth !== null && monthIndex(month) > monthIndex(item.endMonth)) return false
  return offset % STEP[item.frequency] === 0
}

/** Amount of the item in each of `months` (0 where it does not fall due), aligned with `months`. */
export function expandRecurringItem(item: RecurringItem, months: readonly MonthKey[]): number[] {
  return months.map((month) => (fallsDueIn(item, month) ? item.amountCents : 0))
}

/**
 * Planned amount per month of a budget line: the amounts entered by month
 * plus every recurring item, in cents, aligned with `months`. Amounts
 * entered for a month outside `months` (the fiscal year's dates changed
 * since) are ignored.
 */
export function plannedByMonth(
  months: readonly MonthKey[],
  entered: ReadonlyArray<{ month: MonthKey; amountCents: number }>,
  items: readonly RecurringItem[],
): number[] {
  const byMonth = new Map(entered.map((a) => [a.month, a.amountCents]))
  const planned = months.map((month) => byMonth.get(month) ?? 0)
  for (const item of items) {
    expandRecurringItem(item, months).forEach((cents, i) => {
      planned[i] += cents
    })
  }
  return planned
}

/**
 * Spreads an annual amount evenly over `count` months, in cents: every month
 * gets the same share and the last one the rounding remainder, so the parts
 * add up to the total (docs/conventions.md#money).
 */
export function spreadEvenly(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || !Number.isInteger(count) || count <= 0) {
    throw new RangeError('spreadEvenly: integer cents and a positive month count')
  }
  const share = Math.trunc(totalCents / count)
  const parts = Array.from({ length: count }, () => share)
  parts[count - 1] = totalCents - share * (count - 1)
  return parts
}
