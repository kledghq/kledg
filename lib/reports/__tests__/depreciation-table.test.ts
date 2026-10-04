/**
 * Depreciation table of a fiscal year (calculateDepreciationTable), with a
 * mocked Prisma: recorded allowances win over the plan, the plan (linear,
 * prorata temporis in days, PCG art. 214-13 and BOFiP
 * BOI-BIC-AMT-20-20-20-10) fills the years without records, the year's
 * allowance never goes past the depreciable base, and allowances without an
 * accounting entry are counted as not booked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { calculateDepreciationTable } from '@/lib/reports/depreciation.service'

const db = asPrismaMock(prisma)
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dec = (value: string) => new Prisma.Decimal(value)

const FY2024 = { startDate: day('2024-01-01'), endDate: day('2024-12-31') }
const FY2025 = { id: 'fy-2025', companyId: 'company-1', year: 2025, isClosed: false, startDate: day('2025-01-01'), endDate: day('2025-12-31') }

const accounts = {
  assetAccount: { id: 'a-2183', code: '218300', label: 'Matériel de bureau et informatique' },
  depreciationAccount: { id: 'a-28183', code: '281830', label: 'Amortissements du matériel informatique' },
  expenseAccount: { id: 'a-68112', code: '681120', label: 'Dotations aux amortissements des immobilisations corporelles' },
}

interface Record {
  fiscalYearId: string
  amount: string
  accountingEntryId: string | null
  fiscalYear: { startDate: Date; endDate: Date }
}

function asset(id: string, overrides: { value: string; start: string; duration?: number; rate?: string; amortizable?: string; records?: Record[] }) {
  return {
    id,
    label: `Immobilisation ${id}`,
    acquisitionDate: day(overrides.start),
    acquisitionValue: dec(overrides.value),
    amortizableAmount: overrides.amortizable ? dec(overrides.amortizable) : null,
    depreciationMethod: 'linear',
    depreciationRate: overrides.rate ? dec(overrides.rate) : null,
    depreciationDuration: overrides.duration ?? null,
    decliningCoefficient: null,
    depreciationStartDate: day(overrides.start),
    ...accounts,
    depreciations: overrides.records ?? [],
  }
}

describe('calculateDepreciationTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the plan for the years without records and counts the year as not booked', async () => {
    db.fiscalYear.findFirst.mockResolvedValue(FY2025)
    // 12 000,00 over 5 years from 1 July 2024: 2024 earns 184/366 of 2 400,00 = 1 206,56 (leap year).
    db.fixedAsset.findMany.mockResolvedValue([asset('laptop', { value: '12000.00', start: '2024-07-01', duration: 5 })])

    const result = await calculateDepreciationTable('company-1', 'fy-2025')
    expect(db.fiscalYear.findFirst.mock.calls[0][0]?.where).toEqual({ id: 'fy-2025', companyId: 'company-1' })
    expect(db.fixedAsset.findMany.mock.calls[0][0]?.where).toEqual({ companyId: 'company-1', isActive: true })
    expect(result.fiscalYear).toEqual({ id: 'fy-2025', year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31'), isClosed: false })
    expect(result.depreciationTable[0]).toMatchObject({
      acquisitionValue: 12000,
      amortizableAmount: 12000,
      previousDepreciation: 1206.56,
      currentDepreciation: 2400,
      totalDepreciation: 3606.56,
      netBookValue: 8393.44,
      currentPosted: false,
      depreciationRate: 20, // 100 / 5 years
      depreciationDuration: 5,
      assetAccount: accounts.assetAccount,
    })
    expect(result.unposted).toEqual({ count: 1, amount: 2400 })
  })

  it('prefers the recorded allowances, booked when they have an accounting entry', async () => {
    db.fiscalYear.findFirst.mockResolvedValue(FY2025)
    db.fixedAsset.findMany.mockResolvedValue([
      asset('van', {
        value: '3000.00',
        start: '2024-01-01',
        rate: '20',
        records: [
          { fiscalYearId: 'fy-2024', amount: '612.50', accountingEntryId: 'entry-2024', fiscalYear: FY2024 },
          { fiscalYearId: 'fy-2025', amount: '600.00', accountingEntryId: 'entry-2025', fiscalYear: FY2025 },
        ],
      }),
    ])

    const [row] = (await calculateDepreciationTable('company-1', 'fy-2025')).depreciationTable
    expect(row).toMatchObject({ previousDepreciation: 612.5, currentDepreciation: 600, totalDepreciation: 1212.5, netBookValue: 1787.5, currentPosted: true, depreciationRate: 20 })
  })

  it('caps the allowance of the year at what is left of the base, and starts nothing before the start date', async () => {
    db.fiscalYear.findFirst.mockResolvedValue(FY2025)
    db.fixedAsset.findMany.mockResolvedValue([
      // 900,00 already depreciated on a 1 000,00 base: the plan's 500,00 is capped to 100,00.
      asset('chair', {
        value: '1000.00',
        start: '2024-01-01',
        duration: 2,
        records: [{ fiscalYearId: 'fy-2024', amount: '900.00', accountingEntryId: 'entry-2024', fiscalYear: FY2024 }],
      }),
      // Put in service after the year: nothing for 2025.
      asset('press', { value: '5000.00', start: '2026-02-01', duration: 5 }),
      // Depreciable base below the acquisition value (residual value kept).
      asset('car', { value: '20000.00', amortizable: '15000.00', start: '2025-01-01', duration: 5 }),
    ])

    const result = await calculateDepreciationTable('company-1', 'fy-2025')
    const [chair, press, car] = result.depreciationTable
    expect(chair).toMatchObject({ previousDepreciation: 900, currentDepreciation: 100, netBookValue: 0, currentPosted: false })
    expect(press).toMatchObject({ previousDepreciation: 0, currentDepreciation: 0, netBookValue: 5000, currentPosted: true })
    expect(car).toMatchObject({ amortizableAmount: 15000, currentDepreciation: 3000, netBookValue: 17000, currentPosted: false })
    expect(result.unposted).toEqual({ count: 2, amount: 3100 })
  })

  it('counts a recorded allowance without entry as not booked', async () => {
    db.fiscalYear.findFirst.mockResolvedValue(FY2025)
    db.fixedAsset.findMany.mockResolvedValue([
      asset('desk', {
        value: '2000.00',
        start: '2025-01-01',
        duration: 4,
        records: [{ fiscalYearId: 'fy-2025', amount: '500.00', accountingEntryId: null, fiscalYear: FY2025 }],
      }),
    ])
    const result = await calculateDepreciationTable('company-1', 'fy-2025')
    expect(result.depreciationTable[0]).toMatchObject({ currentDepreciation: 500, currentPosted: false })
    expect(result.unposted).toEqual({ count: 1, amount: 500 })
  })

  it('without a fiscal year, adds up every recorded allowance as the current column', async () => {
    db.fiscalYear.findFirst.mockResolvedValue(null)
    db.fixedAsset.findMany.mockResolvedValue([
      asset('van', {
        value: '3000.00',
        start: '2024-01-01',
        duration: 5,
        records: [
          { fiscalYearId: 'fy-2024', amount: '600.00', accountingEntryId: 'e1', fiscalYear: FY2024 },
          { fiscalYearId: 'fy-2025', amount: '600.00', accountingEntryId: null, fiscalYear: FY2025 },
        ],
      }),
    ])

    const result = await calculateDepreciationTable('company-1')
    // The open fiscal year of today is looked up when none is given.
    expect(db.fiscalYear.findFirst.mock.calls[0][0]?.where).toMatchObject({ companyId: 'company-1', isClosed: false })
    expect(result.fiscalYear).toBeNull()
    expect(result.depreciationTable[0]).toMatchObject({ previousDepreciation: 0, currentDepreciation: 1200, totalDepreciation: 1200, netBookValue: 1800, currentPosted: true })
    expect(result.unposted).toEqual({ count: 0, amount: 0 })
  })
})
