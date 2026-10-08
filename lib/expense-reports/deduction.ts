/**
 * The deduction of a company on the days of expense report lines: the
 * franchise (CGI art. 293 B: nothing recovered) and the provisional
 * coefficient de déduction of a partly exempt company (CGI ann. II art. 205
 * and 206), as purchase invoices, simple mode and rules apply them
 * (lib/vat-deduction/coefficient.ts). amounts.ts applies them to each line.
 */

import { vatDeductionOn, type VatDeductionOnDay } from '@/lib/vat-deduction/coefficient'
import type { LineInput } from './amounts'

/** The deduction on each distinct day (one lookup per day). */
export async function deductionByDay(companyId: string, days: readonly string[]): Promise<Map<string, VatDeductionOnDay>> {
  const distinct = [...new Set(days)]
  const values = await Promise.all(distinct.map((day) => vatDeductionOn(companyId, day)))
  return new Map(distinct.map((day, i) => [day, values[i]]))
}

/** The lines with the franchise and the coefficient of their day. */
export async function withDeduction<T extends LineInput>(companyId: string, lines: readonly T[]): Promise<T[]> {
  const byDay = await deductionByDay(companyId, lines.map((l) => l.date))
  return lines.map((line) => {
    const deduction = byDay.get(line.date)
    return { ...line, franchise: deduction?.franchise ?? false, deductionPercent: deduction?.franchise ? null : (deduction?.percent ?? null) }
  })
}

/**
 * The coefficient of each year from `fromYear` to `toYear`, as of the end of
 * the year or `today`: what the line editor previews before the server
 * computes each line on its own day.
 */
export async function deductionPercentByYear(companyId: string, fromYear: number, toYear: number, today: string): Promise<{ franchise: boolean; percentByYear: Record<string, number | null> }> {
  const percentByYear: Record<string, number | null> = {}
  let franchise = false
  for (let year = fromYear; year <= toYear; year += 1) {
    const day = `${year}-12-31` < today ? `${year}-12-31` : today
    const deduction = await vatDeductionOn(companyId, day)
    percentByYear[String(year)] = deduction.franchise ? null : deduction.percent
    if (year === toYear) franchise = deduction.franchise
  }
  return { franchise, percentByYear }
}
