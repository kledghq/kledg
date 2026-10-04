/**
 * Depreciation accumulated at the end of a fiscal year and net book value
 * (lib/fixed-assets/cumulative-depreciation.ts): the plan before the first
 * fiscal year in Kledg, the recorded amounts of a year when there are any,
 * the plan up to the disposal otherwise. Linear plan prorata temporis (PCG
 * art. 214-13, BOFiP BOI-BIC-AMT-20-20-20-10).
 */

import { describe, expect, it } from 'vitest'
import { buildDepreciationPlan } from '../depreciation-plan'
import { cumulativeDepreciationCents, netBookValueCents } from '../cumulative-depreciation'

const utc = (day: string) => new Date(`${day}T00:00:00Z`)
const plan = buildDepreciationPlan({
  acquisitionValue: '10000.00',
  amortizableAmount: null,
  depreciationMethod: 'linear',
  depreciationRate: null,
  depreciationDuration: 5,
  decliningCoefficient: null,
  depreciationStartDate: utc('2024-01-01'),
})
const years = [
  { id: 'fy2026', startDate: utc('2026-01-01'), endDate: utc('2026-12-31') },
  { id: 'fy2027', startDate: utc('2027-01-01'), endDate: utc('2027-12-31') },
]

describe('cumulativeDepreciationCents', () => {
  it('counts the plan before the first fiscal year in Kledg, then each year', () => {
    // 2024 and 2025 (4 000 €) before Kledg, 2026 by the plan (2 000 €)
    expect(cumulativeDepreciationCents({ plan, fiscalYears: years, recordedByFiscalYear: new Map(), until: utc('2026-12-31') })).toBe(600_000)
    expect(cumulativeDepreciationCents({ plan, fiscalYears: years, recordedByFiscalYear: new Map(), until: utc('2027-12-31') })).toBe(800_000)
  })

  it('takes the amount recorded for a year instead of the plan', () => {
    const recorded = new Map([['fy2026', 250_000]])
    expect(cumulativeDepreciationCents({ plan, fiscalYears: years, recordedByFiscalYear: recorded, until: utc('2026-12-31') })).toBe(650_000)
  })

  it('stops at the disposal, prorata temporis', () => {
    // Sold on 30 June 2027: 181 days of 2027, 2 000 x 181 / 365 = 991,78 €
    const total = cumulativeDepreciationCents({ plan, fiscalYears: years, recordedByFiscalYear: new Map(), until: utc('2027-12-31'), disposalDate: utc('2027-06-30') })
    expect(total).toBe(699_178)
    expect(netBookValueCents(1_000_000, { plan, fiscalYears: years, recordedByFiscalYear: new Map(), until: utc('2027-12-31'), disposalDate: utc('2027-06-30') })).toBe(300_822)
  })

  it('never exceeds the base, and is 0 for an asset that is not depreciated', () => {
    const recorded = new Map([['fy2026', 900_000]])
    expect(cumulativeDepreciationCents({ plan, fiscalYears: years, recordedByFiscalYear: recorded, until: utc('2027-12-31') })).toBe(1_000_000)
    const none = buildDepreciationPlan({ acquisitionValue: '5000', amortizableAmount: null, depreciationMethod: 'none', depreciationRate: null, depreciationDuration: null, decliningCoefficient: null, depreciationStartDate: utc('2026-01-01') })
    expect(cumulativeDepreciationCents({ plan: none, fiscalYears: years, recordedByFiscalYear: new Map(), until: utc('2027-12-31') })).toBe(0)
    expect(netBookValueCents(500_000, { plan: none, fiscalYears: years, recordedByFiscalYear: new Map(), until: utc('2027-12-31') })).toBe(500_000)
  })

  it('counts the plan up to the date when the company has no fiscal year yet', () => {
    expect(cumulativeDepreciationCents({ plan, fiscalYears: [], recordedByFiscalYear: new Map(), until: utc('2025-12-31') })).toBe(400_000)
  })
})
