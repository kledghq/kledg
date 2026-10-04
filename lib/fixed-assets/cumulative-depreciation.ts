/**
 * Depreciation of a fixed asset accumulated up to the end of a fiscal year,
 * and its net book value then (pure module). Used by the impairment test
 * (PCG art. 214-15 et seq.: the net book value is compared with the current
 * value) and by the transfer of an investment grant, which follows the
 * depreciation of the asset it financed (PCG art. 312-1).
 *
 * Same sources as the depreciation entries (lib/fixed-assets/depreciation-entries.ts):
 * for each fiscal year, the amounts the user recorded for it
 * (fixed_asset_depreciations), else the plan's amount for the part of the
 * year before the disposal; the plan's amount for the months before the
 * first fiscal year of the company in Kledg (depreciation booked before).
 * Amounts in cents, dates as UTC calendar days.
 */

import { addUtcDays } from '@/lib/utils/date'
import { sumPlanCentsForPeriod, type DepreciationPlan } from './depreciation-plan'
import { toCents } from '@/lib/utils/money'

export interface FiscalYearPeriod {
  id: string
  startDate: Date
  endDate: Date
}

export interface CumulativeDepreciationInput {
  plan: DepreciationPlan
  /** Fiscal years of the company, any order. */
  fiscalYears: FiscalYearPeriod[]
  /** Recorded depreciation per fiscal year id, in cents (sum of its records). */
  recordedByFiscalYear: ReadonlyMap<string, number>
  /** Last day counted (the end of the fiscal year of the test). */
  until: Date
  disposalDate?: Date | null
}

/** Depreciation accumulated from the start of the plan to `until`, in cents, at most the base. */
export function cumulativeDepreciationCents(input: CumulativeDepreciationInput): number {
  const { plan, recordedByFiscalYear, until } = input
  const baseCents = toCents(plan.baseAmount) ?? 0
  if (plan.method === 'none' || baseCents <= 0) return 0
  const disposal = input.disposalDate ?? null
  const years = [...input.fiscalYears].sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
  const capAt = (day: Date) => (disposal && disposal < day ? disposal : day)

  let total = 0
  const first = years[0]
  // Before the first fiscal year in Kledg: what the plan says was depreciated
  if (!first || plan.start < first.startDate) {
    const end = first ? addUtcDays(first.startDate, -1) : until
    const last = capAt(end < until ? end : until)
    if (last >= plan.start) total += sumPlanCentsForPeriod(plan, plan.start, last)
  }
  for (const fy of years) {
    if (fy.endDate > until) break
    const recorded = recordedByFiscalYear.get(fy.id)
    if (recorded !== undefined) {
      total += recorded
      continue
    }
    if (disposal && disposal < fy.startDate) continue
    total += sumPlanCentsForPeriod(plan, fy.startDate, capAt(fy.endDate))
  }
  return Math.min(total, baseCents)
}

/** Net book value at `until`: gross value less the accumulated depreciation, never negative. */
export function netBookValueCents(grossCents: number, input: CumulativeDepreciationInput): number {
  return Math.max(0, grossCents - cumulativeDepreciationCents(input))
}
