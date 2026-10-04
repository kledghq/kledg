/**
 * Declining-balance depreciation (amortissement dégressif) and period sums of
 * the plan (lib/fixed-assets/depreciation-plan.ts).
 *
 * Sources: CGI art. 39 A, 1 (declining rate = linear rate x coefficient;
 * first year prorata in whole months from the first day of the month of
 * acquisition; switch to linear when the linear allowance on the net book
 * value exceeds the declining one), BOFiP BOI-BIC-AMT-20-20-30-20. Allocation
 * in cents with the remainder on a defined line (docs/conventions.md, Money):
 * the months of a year add up to its allowance and the plan to the base.
 */

import { describe, expect, it } from 'vitest'
import { buildDepreciationPlan, sumPlanCentsForPeriod } from '../depreciation-plan'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function declining(base: number | string, years: number, start: string, coefficient: number | null = 1.75) {
  return buildDepreciationPlan({
    acquisitionValue: base,
    amortizableAmount: base,
    depreciationMethod: 'declining',
    depreciationRate: null,
    depreciationDuration: years,
    decliningCoefficient: coefficient,
    depreciationStartDate: day(start),
  })
}

const yearCents = (plan: ReturnType<typeof buildDepreciationPlan>, year: number) =>
  sumPlanCentsForPeriod(plan, day(`${year}-01-01`), day(`${year}-12-31`))

const totalCents = (plan: ReturnType<typeof buildDepreciationPlan>) =>
  [...plan.byMonth.values()].reduce((sum, euros) => sum + Math.round(euros * 100), 0)

describe('declining depreciation plan (CGI art. 39 A)', () => {
  it('applies 35 % (1/5 x 1,75) to the net book value, then switches to linear', () => {
    const plan = declining(10000, 5, '2025-01-01')
    // 3 500,00; 6 500 x 35 % = 2 275,00; 4 225 x 35 % = 1 478,75;
    // then 2 746,25 / 2 years = 1 373,13 (> 961,19 declining) and the rest
    expect([2025, 2026, 2027, 2028, 2029, 2030].map((y) => yearCents(plan, y))).toEqual([350000, 227500, 147875, 137313, 137312, 0])
  })

  it('ends exactly on the base and spreads each year on its months to the cent', () => {
    // Regression: months were rounded one by one (3 500 / 12 = 291,67 x 12 = 3 500,04)
    const plan = declining(10000, 5, '2025-01-01')
    expect(totalCents(plan)).toBe(1000000)
    const months2025 = [...plan.byMonth.entries()].filter(([key]) => key.startsWith('2025-')).map(([, v]) => Math.round(v * 100))
    expect(months2025).toHaveLength(12)
    expect(months2025.reduce((a, b) => a + b, 0)).toBe(350000)
    expect(Math.max(...months2025) - Math.min(...months2025)).toBeLessThanOrEqual(1)

    for (const [base, years, start, coefficient] of [
      ['999.94', 3, '2025-03-10', 1.25],
      ['12345.67', 4, '2025-01-01', 1.25],
      ['7777.77', 7, '2025-11-20', 2.25],
    ] as const) {
      expect(totalCents(declining(base, years, start, coefficient))).toBe(Math.round(Number(base) * 100))
    }
  })

  it('takes a first year prorata in whole months from the month of acquisition', () => {
    // Acquired 15/07/2025: July to December, 6 months: 10 000 x 35 % x 6/12 = 1 750,00
    const plan = declining(10000, 5, '2025-07-15')
    expect(plan.byMonth.has('2025-06')).toBe(false)
    expect(Math.round(plan.byMonth.get('2025-07')! * 100)).toBe(29167)
    expect([2025, 2026, 2027, 2028, 2029, 2030].map((y) => yearCents(plan, y))).toEqual([175000, 288750, 187688, 174281, 174281, 0])
    expect(totalCents(plan)).toBe(1000000)
  })
})

describe('sumPlanCentsForPeriod', () => {
  it('sums the months of a fiscal year straddling two calendar years', () => {
    // Linear 12 000 over 4 years from 01/01/2025: 3 000,00 a year, prorata in days (PCG art. 214-13)
    const plan = buildDepreciationPlan({
      acquisitionValue: 12000,
      amortizableAmount: null,
      depreciationMethod: 'linear',
      depreciationRate: null,
      depreciationDuration: 4,
      decliningCoefficient: null,
      depreciationStartDate: day('2025-01-01'),
    })
    expect(sumPlanCentsForPeriod(plan, day('2025-07-01'), day('2026-06-30'))).toBe(300000)
    // January to June 2025: 181 days out of 365
    expect(sumPlanCentsForPeriod(plan, day('2024-07-01'), day('2025-06-30'))).toBe(148767)
    // March: 3 000 x 90/365 - 3 000 x 59/365 on rounded cumulative totals
    expect(sumPlanCentsForPeriod(plan, day('2025-03-01'), day('2025-03-31'))).toBe(25480)
  })
})
