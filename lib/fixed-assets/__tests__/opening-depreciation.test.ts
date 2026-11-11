/**
 * Opening accumulated depreciation of an asset acquired before the first
 * fiscal year Kledg follows (lib/fixed-assets/depreciation-plan.ts,
 * withOpeningDepreciation; issue #30): the months before the opening day add
 * up to the depreciation booked outside Kledg, the remaining months are
 * rescaled so the plan still ends on the base (PCG art. 214-14, change of
 * estimate applied prospectively).
 */

import { describe, expect, it } from 'vitest'
import { buildDepreciationPlan, sumPlanCentsForPeriod } from '../depreciation-plan'

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
// 12 000 € over 5 years from 1 July 2022: 1 200 € in 2022, 2 400 € a year, 1 200 € in 2027
const asset = {
  acquisitionValue: 12_000,
  amortizableAmount: null,
  depreciationMethod: 'linear',
  depreciationRate: null,
  depreciationDuration: 5,
  decliningCoefficient: null,
  depreciationStartDate: day('2022-07-01'),
}
const year = (plan: ReturnType<typeof buildDepreciationPlan>, y: number) => sumPlanCentsForPeriod(plan, day(`${y}-01-01`), day(`${y}-12-31`))
const total = (plan: ReturnType<typeof buildDepreciationPlan>) => sumPlanCentsForPeriod(plan, day('2000-01-01'), day('2100-12-31'))

const before2025 = (plan: ReturnType<typeof buildDepreciationPlan>) => sumPlanCentsForPeriod(plan, day('2000-01-01'), day('2024-12-31'))
const theoretical = buildDepreciationPlan(asset)
// Theoretical: 1 209,86 € in 2022 (184 days of 365), 2 400 € a year, the rest in 2027
const restTheoretical = 1_200_000 - before2025(theoretical)

describe('opening accumulated depreciation', () => {
  it('leaves the plan as it is without an opening amount', () => {
    expect([2022, 2023, 2024, 2025, 2026].map((y) => year(theoretical, y))).toEqual([120_986, 240_000, 240_000, 240_000, 240_000])
    expect(total(theoretical)).toBe(1_200_000)
  })

  it('less booked before than the plan says: the months before add up to it, the rest is spread in the plan proportions', () => {
    const plan = buildDepreciationPlan({ ...asset, openingDepreciation: 4_000, openingDepreciationDate: day('2025-01-01') })
    expect(before2025(plan)).toBe(400_000)
    const ratio = (1_200_000 - 400_000) / restTheoretical
    for (const y of [2025, 2026, 2027]) expect(Math.abs(year(plan, y) - year(theoretical, y) * ratio)).toBeLessThan(2)
    expect(total(plan)).toBe(1_200_000)
  })

  it('more booked before (full years): less after, same end, never beyond the base', () => {
    const plan = buildDepreciationPlan({ ...asset, openingDepreciation: 9_000, openingDepreciationDate: day('2025-01-01') })
    expect(before2025(plan)).toBe(900_000)
    expect(year(plan, 2025)).toBeLessThan(year(theoretical, 2025))
    expect(year(plan, 2028)).toBe(0)
    expect(total(plan)).toBe(1_200_000)
  })

  it('fully depreciated before Kledg: nothing more to book', () => {
    const plan = buildDepreciationPlan({ ...asset, openingDepreciation: 12_000, openingDepreciationDate: day('2025-01-01') })
    expect([2025, 2026, 2027].map((y) => year(plan, y))).toEqual([0, 0, 0])
    // An opening above the base is capped at the base
    expect(total(buildDepreciationPlan({ ...asset, openingDepreciation: 15_000, openingDepreciationDate: day('2025-01-01') }))).toBe(1_200_000)
  })

  it('past the end of the plan with something left: the rest in the opening month', () => {
    const plan = buildDepreciationPlan({ ...asset, openingDepreciation: 11_000, openingDepreciationDate: day('2028-01-01') })
    expect(year(plan, 2028)).toBe(100_000)
    expect(total(plan)).toBe(1_200_000)
  })

  it('exact to the cent with an amount that does not divide evenly', () => {
    const plan = buildDepreciationPlan({ ...asset, openingDepreciation: '4999.99', openingDepreciationDate: day('2025-01-01') })
    expect(before2025(plan)).toBe(499_999)
    expect(total(plan)).toBe(1_200_000)
  })

  it('declining plan: same shape after the opening day, same total', () => {
    const declining = { ...asset, depreciationMethod: 'declining', depreciationStartDate: day('2022-01-01') }
    const base = buildDepreciationPlan(declining)
    const plan = buildDepreciationPlan({ ...declining, openingDepreciation: 9_000, openingDepreciationDate: day('2025-01-01') })
    expect(total(plan)).toBe(1_200_000)
    expect(before2025(plan)).toBe(900_000)
    expect(year(plan, 2025) / year(plan, 2026)).toBeCloseTo(year(base, 2025) / year(base, 2026), 3)
  })
})

describe('fiscal years closing mid-month (code review)', () => {
  // 12 000 € over 4 years from 15 March 2025: 3 000 € a year; fiscal years 15/03 to 14/03
  const midMonth = { ...asset, depreciationDuration: 4, depreciationStartDate: day('2025-03-15') }
  const plan = buildDepreciationPlan(midMonth)
  const fy = (y: number) => sumPlanCentsForPeriod(plan, day(`${y}-03-15`), day(`${y + 1}-03-14`))

  it('splits the month shared by two fiscal years instead of counting it in both', () => {
    // A full year of service is 3 000 € to the cent or so, not 13/12 of it
    expect(Math.abs(fy(2025) - 300_000)).toBeLessThanOrEqual(1)
    expect(Math.abs(fy(2026) - 300_000)).toBeLessThanOrEqual(1)
    // The years add up exactly to the base, never beyond
    const total = [2025, 2026, 2027, 2028].reduce((s, y) => s + fy(y), 0)
    expect(total).toBe(1_200_000)
  })

  it('keeps whole-month periods as they were', () => {
    const calendar = buildDepreciationPlan(asset)
    expect(sumPlanCentsForPeriod(calendar, day('2023-01-01'), day('2023-12-31'))).toBe(240_000)
  })
})

describe('declining method on fiscal years (BOI-BIC-AMT-20-20-30-20)', () => {
  // 10 000 € over 5 years, coefficient 1,75 (35 %), in service in September 2025
  const declining = { ...asset, acquisitionValue: 10_000, depreciationDuration: 5, depreciationMethod: 'declining', depreciationStartDate: day('2025-09-01') }

  it('applies the first-year prorata and the rate per fiscal year closing in June', () => {
    const plan = buildDepreciationPlan({ ...declining, fiscalYearClosingMonth: 6 })
    // Year ending 30/06/2026: 10 000 x 35 % x 10/12 = 2 916,67 €
    expect(sumPlanCentsForPeriod(plan, day('2025-07-01'), day('2026-06-30'))).toBe(291_667)
    // Next year on the net book value: (10 000 - 2 916,67) x 35 % = 2 479,17 €
    expect(sumPlanCentsForPeriod(plan, day('2026-07-01'), day('2027-06-30'))).toBe(247_917)
    expect(sumPlanCentsForPeriod(plan, day('2000-01-01'), day('2100-12-31'))).toBe(1_000_000)
  })

  it('keeps calendar years when the fiscal year closes in December', () => {
    const plan = buildDepreciationPlan(declining)
    // 2025: 10 000 x 35 % x 4/12 = 1 166,67 €
    expect(sumPlanCentsForPeriod(plan, day('2025-01-01'), day('2025-12-31'))).toBe(116_667)
    expect(sumPlanCentsForPeriod(buildDepreciationPlan({ ...declining, fiscalYearClosingMonth: 12 }), day('2025-01-01'), day('2025-12-31'))).toBe(116_667)
  })
  it('an opening day inside a month splits that month: the days before add up to the opening amount', () => {
    // 4 000 € booked up to 14 March 2025 (a fiscal year opening on 15 March)
    const plan = buildDepreciationPlan({ ...asset, openingDepreciation: 4_000, openingDepreciationDate: day('2025-03-15') })
    expect(sumPlanCentsForPeriod(plan, day('2000-01-01'), day('2025-03-14'))).toBe(400_000)
    expect(sumPlanCentsForPeriod(plan, day('2025-03-15'), day('2100-12-31'))).toBe(800_000)
    // A fiscal year from 15 March to 14 March: the months add up across the cut
    const firstYear = sumPlanCentsForPeriod(plan, day('2025-03-15'), day('2026-03-14'))
    const secondYear = sumPlanCentsForPeriod(plan, day('2026-03-15'), day('2027-03-14'))
    expect(firstYear + secondYear + sumPlanCentsForPeriod(plan, day('2027-03-15'), day('2100-12-31'))).toBe(800_000)
    expect(total(plan)).toBe(1_200_000)
  })

  it('an opening day on the first of the month changes nothing in that month', () => {
    const plan = buildDepreciationPlan({ ...asset, openingDepreciation: 4_000, openingDepreciationDate: day('2025-03-01') })
    expect(plan.opening).toBeUndefined()
    expect(sumPlanCentsForPeriod(plan, day('2000-01-01'), day('2025-02-28'))).toBe(400_000)
    expect(total(plan)).toBe(1_200_000)
  })

  it('nothing booked before a mid-month opening day: the days before it carry nothing', () => {
    const plan = buildDepreciationPlan({ ...asset, openingDepreciation: 0, openingDepreciationDate: day('2025-03-15') })
    expect(sumPlanCentsForPeriod(plan, day('2000-01-01'), day('2025-03-14'))).toBe(0)
    expect(total(plan)).toBe(1_200_000)
  })
})
