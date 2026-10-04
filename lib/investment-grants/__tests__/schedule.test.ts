/**
 * Transfer of investment grants to the result (lib/investment-grants/schedule.ts).
 *
 * Sources: PCG art. 312-1 (same rhythm as the depreciation of the financed
 * asset; inalienability period; tenths without such a clause); CGI art. 42
 * septies and BOFiP BOI-BIC-PDSTK-10-30-10-20 (same spreading for tax, the
 * balance taken into the result when the asset is sold); chart of accounts
 * 139 and 747 (ANC 2022-06).
 */

import { describe, expect, it } from 'vitest'
import { buildDepreciationPlan } from '@/lib/fixed-assets/depreciation-plan'
import { cumulativeDepreciationCents } from '@/lib/fixed-assets/cumulative-depreciation'
import { cumulativeTransferCents, transferDueCents, transferLines, GRANT_ACCOUNTS, type GrantTerms, type ScheduleYear } from '../schedule'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'

const fy = (year: number): ScheduleYear => ({ year, startDate: `${year}-01-01`, endDate: `${year}-12-31` })
const utc = (day: string) => new Date(`${day}T00:00:00Z`)

describe('grant financing a depreciable asset (PCG art. 312-1)', () => {
  it('follows the depreciation: 30 000 € on an asset of 100 000 € over 5 years gives 6 000 € a year', () => {
    const terms: GrantTerms = { amountCents: 3_000_000, spreading: 'ASSET', grantedOn: '2026-01-15', durationYears: null }
    const shares = [2026, 2027, 2028, 2029, 2030].map((year, i) => {
      const asset = { depreciable: true, baseCents: 10_000_000, depreciatedCents: 2_000_000 * (i + 1), disposed: false }
      const before = i === 0 ? 0 : cumulativeTransferCents(terms, fy(year - 1), { grantYear: 2026, asset: { ...asset, depreciatedCents: 2_000_000 * i } })
      return transferDueCents(terms, fy(year), { grantYear: 2026, asset }, before)
    })
    expect(shares).toEqual([600_000, 600_000, 600_000, 600_000, 600_000])
  })

  it('follows the prorata temporis of the first year', () => {
    // Asset of 50 000 € in service on 1 July 2026, 5 years: 2026 depreciation 10 000 x 184 / 365 = 5 041,10 €
    const plan = buildDepreciationPlan({
      acquisitionValue: '50000',
      amortizableAmount: null,
      depreciationMethod: 'linear',
      depreciationRate: null,
      depreciationDuration: 5,
      decliningCoefficient: null,
      depreciationStartDate: utc('2026-07-01'),
    })
    const years = [2026, 2027].map((y) => ({ id: `fy${y}`, startDate: utc(`${y}-01-01`), endDate: utc(`${y}-12-31`) }))
    const depreciated = cumulativeDepreciationCents({ plan, fiscalYears: years, recordedByFiscalYear: new Map(), until: utc('2026-12-31') })
    expect(depreciated).toBe(504_110)
    // A grant of 20 000 € (40 % of the base): 2 016,44 € the first year
    const terms: GrantTerms = { amountCents: 2_000_000, spreading: 'ASSET', grantedOn: '2026-06-01', durationYears: null }
    expect(cumulativeTransferCents(terms, fy(2026), { grantYear: 2026, asset: { depreciable: true, baseCents: 5_000_000, depreciatedCents: depreciated, disposed: false } })).toBe(201_644)
  })

  it('takes the balance into the result of the year the asset is sold (CGI art. 42 septies)', () => {
    const terms: GrantTerms = { amountCents: 3_000_000, spreading: 'ASSET', grantedOn: '2026-01-15', durationYears: null }
    const sold = { depreciable: true, baseCents: 10_000_000, depreciatedCents: 5_000_000, disposed: true }
    expect(cumulativeTransferCents(terms, fy(2028), { grantYear: 2026, asset: sold })).toBe(3_000_000)
    expect(transferDueCents(terms, fy(2028), { grantYear: 2026, asset: sold }, 1_200_000)).toBe(1_800_000)
  })

  it('transfers nothing before the grant, nor without the asset', () => {
    const terms: GrantTerms = { amountCents: 3_000_000, spreading: 'ASSET', grantedOn: '2027-02-01', durationYears: null }
    const asset = { depreciable: true, baseCents: 10_000_000, depreciatedCents: 2_000_000, disposed: false }
    expect(cumulativeTransferCents(terms, fy(2026), { grantYear: 2027, asset })).toBe(0)
    expect(cumulativeTransferCents({ ...terms, grantedOn: '2026-02-01' }, fy(2026), { grantYear: 2026, asset: null })).toBe(0)
  })
})

describe('grant financing a non-depreciable asset (PCG art. 312-1)', () => {
  it('spreads over the inalienability period, the shares adding up to the grant', () => {
    // 1 000 € inalienable 3 years: 333,33 €, 333,34 €, 333,33 €
    const terms: GrantTerms = { amountCents: 100_000, spreading: 'INALIENABILITY', grantedOn: '2026-03-01', durationYears: 3 }
    const cumulative = [2026, 2027, 2028, 2029].map((y) => cumulativeTransferCents(terms, fy(y), { grantYear: 2026 }))
    expect(cumulative).toEqual([33_333, 66_667, 100_000, 100_000])
    expect(transferDueCents(terms, fy(2027), { grantYear: 2026 }, 33_333)).toBe(33_334)
  })

  it('transfers a tenth a year without inalienability clause', () => {
    const terms: GrantTerms = { amountCents: 1_000_000, spreading: 'TENTHS', grantedOn: '2026-09-30', durationYears: null }
    expect(cumulativeTransferCents(terms, fy(2026), { grantYear: 2026 })).toBe(100_000)
    expect(cumulativeTransferCents(terms, fy(2030), { grantYear: 2026 })).toBe(500_000)
    expect(cumulativeTransferCents(terms, fy(2035), { grantYear: 2026 })).toBe(1_000_000)
    expect(cumulativeTransferCents(terms, fy(2040), { grantYear: 2026 })).toBe(1_000_000)
  })
})

describe('grant spread linearly (asset not followed in Kledg)', () => {
  it('spreads like a linear depreciation of the grant from the day it is awarded', () => {
    const terms: GrantTerms = { amountCents: 1_200_000, spreading: 'LINEAR', grantedOn: '2026-01-01', durationYears: 4 }
    expect([2026, 2027, 2028, 2029, 2030].map((y) => cumulativeTransferCents(terms, fy(y), { grantYear: 2026 }))).toEqual([300_000, 600_000, 900_000, 1_200_000, 1_200_000])
  })

  it('never takes back a share booked too early', () => {
    const terms: GrantTerms = { amountCents: 1_200_000, spreading: 'LINEAR', grantedOn: '2026-01-01', durationYears: 4 }
    expect(transferDueCents(terms, fy(2026), { grantYear: 2026 }, 500_000)).toBe(0)
  })
})

describe('transfer entry', () => {
  it('debits 139 and credits 747, accounts of the 2025 chart', () => {
    const chart = new Map(PCG_ACCOUNTS.map((a) => [a.code, a.label]))
    for (const account of Object.values(GRANT_ACCOUNTS)) expect(chart.get(account.code)).toBe(account.label)
    expect(transferLines(600_000, { transfer: GRANT_ACCOUNTS.transfer, income: GRANT_ACCOUNTS.income })).toEqual([
      { code: '139', label: GRANT_ACCOUNTS.transfer.label, debitCents: 600_000, creditCents: 0 },
      { code: '747', label: GRANT_ACCOUNTS.income.label, debitCents: 0, creditCents: 600_000 },
    ])
    expect(transferLines(0, { transfer: GRANT_ACCOUNTS.transfer, income: GRANT_ACCOUNTS.income })).toEqual([])
  })
})
