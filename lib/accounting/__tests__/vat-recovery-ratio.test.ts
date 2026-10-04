/**
 * Recovery ratio of deductible VAT for a company partly exempt (CGI art. 271
 * and annexe II art. 206: deduction in proportion of the operations that
 * give the right to deduct). Sums are made in cents.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    company: { findUnique: mocks.findUnique },
    accountingEntry: { findMany: mocks.findMany },
  },
}))

import { calculateVatRecoveryRatio } from '../vat-recovery-ratio'

type Line = { code: string; credit: string }
const entry = (...lines: Line[]) => ({
  lines: lines.map((l) => ({ credit: { toString: () => l.credit }, account: { code: l.code } })),
})

const start = new Date('2026-03-01T00:00:00.000Z')
const end = new Date('2026-03-31T00:00:00.000Z')

describe('calculateVatRecoveryRatio', () => {
  beforeEach(() => {
    mocks.findUnique.mockReset().mockResolvedValue({ isVatExempt: true })
    mocks.findMany.mockReset()
  })

  it('is null for a company that is not exempt (full recovery)', async () => {
    mocks.findUnique.mockResolvedValue({ isVatExempt: false })
    expect(await calculateVatRecoveryRatio('c', start, end)).toBeNull()
  })

  it('divides the revenue invoiced with VAT by the total revenue', async () => {
    const withVat = entry({ code: '706', credit: '0.10' }, { code: '706', credit: '0.20' }, { code: '44571', credit: '0.06' })
    const exempt = entry({ code: '706', credit: '0.70' })
    mocks.findMany.mockResolvedValueOnce([withVat, exempt]).mockResolvedValueOnce([withVat])
    // 30 cents with VAT out of 100 cents
    expect(await calculateVatRecoveryRatio('c', start, end)).toBe(0.3)
  })

  it('estimates the revenue with VAT at five times the VAT collected (20 % rate) when entries do not pair them', async () => {
    const revenue = entry({ code: '706', credit: '1000.00' })
    const vatOnly = entry({ code: '44571', credit: '40.00' })
    mocks.findMany.mockResolvedValueOnce([revenue]).mockResolvedValueOnce([vatOnly])
    expect(await calculateVatRecoveryRatio('c', start, end)).toBe(0.2)
  })

  it('is 0 without revenue', async () => {
    mocks.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    expect(await calculateVatRecoveryRatio('c', start, end)).toBe(0)
  })
})
