/**
 * The VAT recovery ratio of a VAT-exempt company is computed over a calendar
 * month: the month of the transaction (rule executor) or the current month
 * (rule simulator). The month never depends on the server timezone: a
 * transaction of 1 March stored at midnight UTC is in March on a server in
 * Los Angeles, where local time still reads 28 February.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  calculateVatRecoveryRatio: vi.fn(),
  companyFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    company: { findUnique: mocks.companyFindUnique },
    account: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/lib/accounting/fiscal-year-utils', () => ({ getActiveFiscalYear: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/accounting/vat-recovery-ratio', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/accounting/vat-recovery-ratio')>()
  return { ...actual, calculateVatRecoveryRatio: mocks.calculateVatRecoveryRatio }
})

import { vatRecoveryMonthOf } from '@/lib/accounting/vat-recovery-ratio'
import { simulateRuleFromData } from '../rule-simulator'

const ORIGINAL_TZ = process.env.TZ
const ZONES = ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

const iso = (d: Date) => d.toISOString()

describe.each(ZONES)('VAT recovery month with TZ=%s', (zone) => {
  beforeEach(() => {
    process.env.TZ = zone
    mocks.calculateVatRecoveryRatio.mockReset().mockResolvedValue(0.5)
    mocks.companyFindUnique.mockReset().mockResolvedValue({ isVatExempt: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('takes the calendar month of a stored date', () => {
    const { periodStart, periodEnd } = vatRecoveryMonthOf(new Date('2026-03-01T00:00:00.000Z'))
    expect(iso(periodStart)).toBe('2026-03-01T00:00:00.000Z')
    expect(iso(periodEnd)).toBe('2026-03-31T00:00:00.000Z')
  })

  it('ends February on the 29th of a leap year and December on the 31st', () => {
    expect(iso(vatRecoveryMonthOf(new Date('2028-02-15T00:00:00.000Z')).periodEnd)).toBe('2028-02-29T00:00:00.000Z')
    const december = vatRecoveryMonthOf(new Date('2025-12-31T00:00:00.000Z'))
    expect(iso(december.periodStart)).toBe('2025-12-01T00:00:00.000Z')
    expect(iso(december.periodEnd)).toBe('2025-12-31T00:00:00.000Z')
  })

  it('simulates with the ratio of the current UTC month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 1 March 05:00 UTC: still 28 February in Los Angeles, already 1 March 19:00 in Kiritimati
    vi.setSystemTime(new Date('2026-03-01T05:00:00.000Z'))

    await simulateRuleFromData(
      {
        entryLines: [
          { accountCode: '606', lineType: 'auto', amountType: 'full', order: 0, vatType: 'deductible', vatRate: 20, vatAccountCode: '44566' },
        ],
      },
      { amount: 120, side: 'debit', label: 'Achat' },
      'company-1',
    )

    expect(mocks.calculateVatRecoveryRatio).toHaveBeenCalledTimes(1)
    const [, periodStart, periodEnd] = mocks.calculateVatRecoveryRatio.mock.calls[0]
    expect(iso(periodStart)).toBe('2026-03-01T00:00:00.000Z')
    expect(iso(periodEnd)).toBe('2026-03-31T00:00:00.000Z')
  })
})
