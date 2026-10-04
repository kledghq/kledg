/**
 * Depreciation status of a fixed asset (lib/fixed-assets/get-depreciation-status.service.ts)
 * and the period of a depreciation record. Plan: linear, prorata temporis in
 * days from the in-service date (PCG art. 214-13, BOFiP
 * BOI-BIC-AMT-20-20-20-10).
 */

import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { buildDepreciationStatus, type DepreciationStatusInput } from '../get-depreciation-status.service'
import { depreciationPeriod } from '../manage-depreciation-records.service'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const asset = {
  id: 'fa-1',
  companyId: 'c-1',
  label: 'Ordinateur',
  comment: null,
  acquisitionDate: day('2025-03-15'),
  acquisitionValue: new Prisma.Decimal('1200'),
  amortizableAmount: null,
  disposalDate: null,
  depreciationRate: null,
  depreciationDuration: 3,
  depreciationMethod: 'linear',
  decliningCoefficient: null,
  depreciationStartDate: day('2025-03-15'),
  assetAccountId: 'a-2183',
  depreciationAccountId: 'a-28183',
  expenseAccountId: 'a-6811',
  isActive: true,
  isFullyPaid: true,
  acquisitionEntryId: null,
  createdAt: day('2025-03-15'),
  updatedAt: day('2025-03-15'),
} satisfies DepreciationStatusInput['fixedAsset']

const fiscalYear = (year: number) => ({
  id: `fy-${year}`,
  year,
  startDate: day(`${year}-01-01`),
  endDate: day(`${year}-12-31`),
  isClosed: false,
})

type RecordRow = DepreciationStatusInput['records'][number]

function record(fields: Partial<RecordRow> & Pick<RecordRow, 'id' | 'fiscalYearId' | 'periodType' | 'year'>, amount: string): RecordRow {
  return {
    companyId: 'c-1',
    fixedAssetId: 'fa-1',
    monthIndex: null,
    note: null,
    accountingEntryId: null,
    accountingEntry: null,
    createdAt: day('2025-12-31'),
    updatedAt: day('2025-12-31'),
    ...fields,
    amount: new Prisma.Decimal(amount),
  }
}

describe('buildDepreciationStatus', () => {
  const fiscalYears = [fiscalYear(2024), fiscalYear(2025), fiscalYear(2026)]

  it('lists the fiscal years from the depreciation start and the plan years without fiscal year as virtual', () => {
    const status = buildDepreciationStatus({ fixedAsset: asset, fiscalYears, records: [], now: day('2026-06-01') })
    expect(status.fiscalYears.map((y) => [y.year, y.virtual])).toEqual([
      [2025, false],
      [2026, false],
      [2027, true],
      [2028, true],
    ])
    // 1200 / 3 x 292 / 365 in 2025, then 400, 400 and the remainder (73 days).
    expect(status.fiscalYears.map((y) => y.suggestedAmount)).toEqual([320, 400, 400, 80])
    expect(status.baseAmount).toBe(1200)
    expect(status.totalPosted).toBe(0)
    expect(status.remainingCapacity).toBe(1200)
    expect(status.done).toBe(false)
    // A real fiscal year lists its 12 months; a virtual year skips the months before the start.
    expect(status.fiscalYears[0].months).toHaveLength(12)
    expect(status.fiscalYears[0].months[0]).toMatchObject({ monthIndex: 0, calendarYear: 2025, suggestedAmount: 0, posted: null })
  })

  it('sums the recorded amounts in cents and labels them like entries', () => {
    const records = [
      record({ id: 'r-1', fiscalYearId: 'fy-2025', periodType: 'month', monthIndex: 3, year: 2025 }, '0.10'),
      record({ id: 'r-2', fiscalYearId: 'fy-2025', periodType: 'month', monthIndex: 4, year: 2025 }, '0.20'),
    ]
    const status = buildDepreciationStatus({ fixedAsset: asset, fiscalYears, records, now: day('2025-06-01') })
    const year2025 = status.fiscalYears[0]
    expect(year2025.postedAmount).toBe(0.3)
    expect(year2025.amount).toBe(0.3)
    expect(status.totalPosted).toBe(0.3)
    expect(status.remainingCapacity).toBe(1199.7)
    expect(status.done).toBe(true)
    expect(year2025.months[3].posted).toMatchObject({ id: 'r-1', amount: 0.1 })
    expect(year2025.entries.map((e) => [e.entryNumber, e.description])).toEqual([
      ['AMR-R-1', 'Amortissement avril 2025'],
      ['AMR-R-2', 'Amortissement mai 2025'],
    ])
  })

  it('shares what remains to depreciate between the years without record, in proportion to the plan', () => {
    const records = [
      record(
        {
          id: 'r-year',
          fiscalYearId: 'fy-2025',
          periodType: 'year',
          year: 2025,
          accountingEntryId: 'e-1',
          accountingEntry: { id: 'e-1', entryNumber: '12', date: day('2025-12-31') },
        },
        '300',
      ),
    ]
    const status = buildDepreciationStatus({ fixedAsset: asset, fiscalYears, records, now: day('2026-06-01') })
    expect(status.fiscalYears[0].yearlyRecord).toEqual({
      id: 'r-year',
      amount: 300,
      note: null,
      accountingEntry: { id: 'e-1', entryNumber: '12', date: day('2025-12-31') },
    })
    expect(status.fiscalYears[0].entries[0].entryNumber).toBe('12')
    // 900 left, weights 400 / 400 / 80 of 880.
    expect(status.fiscalYears.slice(1).map((y) => y.suggestedAmount)).toEqual([409.09, 409.09, 81.82])
    expect(status.remainingCapacity).toBe(900)
    expect(status.done).toBe(false)
  })

  it('leaves out the fiscal years after the plan that hold no record', () => {
    const later = [...fiscalYears, fiscalYear(2029)]
    const status = buildDepreciationStatus({ fixedAsset: asset, fiscalYears: later, records: [], now: day('2026-06-01') })
    expect(status.fiscalYears.map((y) => y.year)).not.toContain(2029)
  })
})

describe('depreciationPeriod', () => {
  const offset = { startDate: day('2025-07-01'), endDate: day('2026-06-30') }

  it('is the whole fiscal year for a yearly record', () => {
    expect(depreciationPeriod(offset, 'year', undefined)).toEqual({
      calendarYear: 2025,
      monthIndex: null,
      start: day('2025-07-01'),
      end: day('2026-06-30'),
    })
  })

  it('places a month of a fiscal year spanning two calendar years in the right year', () => {
    expect(depreciationPeriod(offset, 'month', 8)).toMatchObject({ calendarYear: 2025, start: day('2025-09-01'), end: day('2025-09-30') })
    expect(depreciationPeriod(offset, 'month', 1)).toMatchObject({ calendarYear: 2026, start: day('2026-02-01'), end: day('2026-02-28') })
  })

  it('refuses a monthly record without a month between 0 and 11', () => {
    expect(() => depreciationPeriod(offset, 'month', undefined)).toThrow("Indiquez le mois (0 à 11) d'un amortissement mensuel")
    expect(() => depreciationPeriod(offset, 'month', 12)).toThrow('Indiquez le mois')
  })
})
