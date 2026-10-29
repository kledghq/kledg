/**
 * Months of the monthly profit and loss (get_monthly_pnl): the last twelve
 * full months by default, "today" being the calendar day in France, at most
 * 24 months, and every month answered even without entries. The totals
 * themselves are summed by PostgreSQL (monthly-pnl.db.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { ValidationError } from '@/lib/accounting/errors'
import { getMonthlyPnl, pnlMonths } from '../get-monthly-pnl.service'

const db = asPrismaMock(prisma)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pnlMonths', () => {
  it('defaults to the last twelve full months', () => {
    expect(pnlMonths({}, '2026-10-29')).toEqual([
      '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ])
    expect(pnlMonths({}, '2026-01-01')).toHaveLength(12)
    expect(pnlMonths({}, '2026-01-01').at(-1)).toBe('2025-12')
  })

  it('counts eleven months back from the last month asked, and up to the last full month from the first', () => {
    expect(pnlMonths({ to: '2026-03' }, '2026-10-29')).toEqual(expect.arrayContaining(['2025-04', '2026-03']))
    expect(pnlMonths({ to: '2026-03' }, '2026-10-29')).toHaveLength(12)
    expect(pnlMonths({ from: '2026-07' }, '2026-10-29')).toEqual(['2026-07', '2026-08', '2026-09'])
    // The current month alone, to date
    expect(pnlMonths({ from: '2026-10' }, '2026-10-29')).toEqual(['2026-10'])
    expect(pnlMonths({ from: '2024-10', to: '2026-09' }, '2026-10-29')).toHaveLength(24)
  })

  it('refuses a period that ends before it starts or covers more than 24 months', () => {
    expect(() => pnlMonths({ from: '2026-05', to: '2026-04' }, '2026-10-29')).toThrow(ValidationError)
    expect(() => pnlMonths({ from: '2026-05', to: '2026-04' }, '2026-10-29')).toThrow('Le mois de début (2026-05) est après le mois de fin (2026-04).')
    expect(() => pnlMonths({ from: '2024-09', to: '2026-09' }, '2026-10-29')).toThrow(
      '24 mois au plus par appel : de 2024-09 à 2026-09, il y en a 25. Découpez la période.',
    )
  })
})

describe('getMonthlyPnl', () => {
  it('reads today in France: at 00:30 in Paris on 1 February, January is the last full month', async () => {
    db.$queryRaw.mockResolvedValue([])
    const months = await getMonthlyPnl('c1', {}, new Date('2026-01-31T23:30:00Z'))
    expect(months.at(-1)?.month).toBe('2026-01')
  })

  it('answers every month, zero without entries, the result being produits minus charges', async () => {
    db.$queryRaw.mockResolvedValue([{ year: 2026, month: 1, revenue: BigInt(1_250_050), turnover: BigInt(1_200_000), expenses: BigInt(830_025) }])
    expect(await getMonthlyPnl('c1', { from: '2026-01', to: '2026-03' })).toEqual([
      { month: '2026-01', revenueCents: 0, chiffreAffairesCents: 0, expensesCents: 0, resultCents: 0 },
      { month: '2026-02', revenueCents: 1_250_050, chiffreAffairesCents: 1_200_000, expensesCents: 830_025, resultCents: 420_025 },
      { month: '2026-03', revenueCents: 0, chiffreAffairesCents: 0, expensesCents: 0, resultCents: 0 },
    ])
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
  })
})
