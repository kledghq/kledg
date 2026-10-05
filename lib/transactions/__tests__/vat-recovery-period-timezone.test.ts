/**
 * The share of deductible VAT a company recovers is its provisional
 * coefficient de déduction of the calendar year of the day (CGI ann. II
 * art. 206, lib/vat-deduction/coefficient.ts): the rule simulator asks for
 * the UTC calendar day of today. The day never depends on the server
 * timezone: at 05:00 UTC on 1 January 2026 it is still 31 December 2025 in
 * Los Angeles, and the year of the coefficient is 2026.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  vatDeductionShareOn: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    account: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/lib/accounting/fiscal-year-utils', () => ({ getActiveFiscalYear: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/vat-deduction/coefficient', () => ({ vatDeductionShareOn: mocks.vatDeductionShareOn }))

import { simulateRuleFromData } from '../rule-simulator'

const ORIGINAL_TZ = process.env.TZ
const ZONES = ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

const simulate = () =>
  simulateRuleFromData(
    { entryLines: [{ accountCode: '606', lineType: 'auto', amountType: 'full', order: 0, vatType: 'deductible', vatRate: 20, vatAccountCode: '44566' }] },
    { amount: 120, side: 'debit', label: 'Achat' },
    'company-1',
  )

describe.each(ZONES)('coefficient de déduction day with TZ=%s', (zone) => {
  beforeEach(() => {
    process.env.TZ = zone
    mocks.vatDeductionShareOn.mockReset().mockResolvedValue(0.5)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('simulates with the coefficient of the current UTC day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T05:00:00.000Z'))

    await simulate()

    expect(mocks.vatDeductionShareOn).toHaveBeenCalledTimes(1)
    const [companyId, day] = mocks.vatDeductionShareOn.mock.calls[0]
    expect(companyId).toBe('company-1')
    expect((day as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('shows no recovery when the coefficient cannot be read', async () => {
    mocks.vatDeductionShareOn.mockRejectedValue(new Error('database down'))
    const result = await simulate()
    expect(result.entryLines.map((l) => l.account.code)).toEqual(['606'])
  })
})
