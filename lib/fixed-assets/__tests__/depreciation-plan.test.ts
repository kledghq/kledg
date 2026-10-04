/**
 * Linear depreciation, prorata temporis in days from the in-service date.
 * Sources: PCG art. 214-13 (depreciation starts when the asset starts being
 * used), CGI art. 39, 1-2° and BOFiP BOI-BIC-AMT-20-20-20-10 (linear
 * allowance base x rate, reduced in proportion to the time of use in the
 * first year).
 */

import { describe, expect, it } from 'vitest'
import { buildDepreciationPlan, sumPlanForPeriod } from '../depreciation-plan'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const yearOf = (plan: ReturnType<typeof buildDepreciationPlan>, year: number) =>
  sumPlanForPeriod(plan, day(`${year}-01-01`), day(`${year}-12-31`))

function linear(base: number, years: number, start: string) {
  return buildDepreciationPlan({
    acquisitionValue: base,
    amortizableAmount: base,
    depreciationMethod: 'linear',
    depreciationRate: null,
    depreciationDuration: years,
    decliningCoefficient: null,
    depreciationStartDate: day(start),
  })
}

describe('linear depreciation plan', () => {
  it('gives exactly base x rate for a full year, leap years included', () => {
    const plan = linear(10000, 4, '2023-01-01')
    expect(yearOf(plan, 2023)).toBe(2500)
    expect(yearOf(plan, 2024)).toBe(2500) // 366 days
    expect(yearOf(plan, 2025)).toBe(2500)
    expect(yearOf(plan, 2026)).toBe(2500)
    expect(yearOf(plan, 2027)).toBe(0)
  })

  it('applies the prorata of days in service to the first and last years', () => {
    // In service on 15/03/2025: 292 days out of 365 in 2025.
    const plan = linear(1200, 3, '2025-03-15')
    expect(yearOf(plan, 2025)).toBe(320) // 1200 / 3 x 292 / 365
    expect(yearOf(plan, 2026)).toBe(400)
    expect(yearOf(plan, 2027)).toBe(400)
    expect(yearOf(plan, 2028)).toBe(80) // the remainder: 73 days
  })

  it('ends exactly on the depreciable base', () => {
    const plan = linear(999.99, 3, '2025-08-07')
    const total = [2025, 2026, 2027, 2028].reduce((s, y) => s + yearOf(plan, y), 0)
    expect(Math.round(total * 100)).toBe(99999)
  })

  it('uses the depreciation rate when no duration is given', () => {
    const plan = buildDepreciationPlan({
      acquisitionValue: 5000,
      amortizableAmount: null,
      depreciationMethod: 'linear',
      depreciationRate: 20,
      depreciationDuration: null,
      decliningCoefficient: null,
      depreciationStartDate: day('2025-01-01'),
    })
    expect(yearOf(plan, 2025)).toBe(1000)
  })

  it('has no allowance for a non-depreciable asset', () => {
    const plan = buildDepreciationPlan({
      acquisitionValue: 5000,
      amortizableAmount: 5000,
      depreciationMethod: 'none',
      depreciationRate: null,
      depreciationDuration: 5,
      decliningCoefficient: null,
      depreciationStartDate: day('2025-01-01'),
    })
    expect(yearOf(plan, 2025)).toBe(0)
  })
})
