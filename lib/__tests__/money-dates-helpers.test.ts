/**
 * KLEDG-R3-QUAL-26: euro sums and comparisons in cents, rates validated
 * rather than rounded, day arithmetic through lib/utils/date.ts.
 */

import { describe, expect, it } from 'vitest'
import { checkEntryCompliance } from '@/lib/pcg/entry-compliance'
import { validateEntryBalance } from '@/lib/transactions/entry-line-calculator'
import { percentInput } from '@/lib/mcp/euros'
import { averageMonthlyChange } from '@/lib/cash-forecast/flows'
import { addMonths, daysInclusive, endOfMonth } from '@/lib/cash-forecast/projection'
import { dueDateOf } from '@/lib/reports/third-parties/payment-terms'
import { trialBalanceStatement } from '@/lib/mcp/views/builders'

describe('balances compare in cents', () => {
  it('a one cent imbalance is an imbalance, float noise is not', () => {
    const date = new Date('2026-03-01T00:00:00Z')
    const unbalanced = checkEntryCompliance({ date, lines: [{ accountId: 'a', debit: 10, credit: 0 }, { accountId: 'b', debit: 0, credit: 9.99 }] })
    expect(unbalanced.violations.map((v) => v.ruleId)).toContain('112-2')
    const noise = checkEntryCompliance({ date, lines: [{ accountId: 'a', debit: 0.1 + 0.2, credit: 0 }, { accountId: 'b', debit: 0, credit: 0.3 }] })
    expect(noise.compliant).toBe(true)
    expect(validateEntryBalance([{ accountId: 'a', debit: 0.1 + 0.2, credit: 0, description: '' }, { accountId: 'b', debit: 0, credit: 0.3, description: '' }])).toBe(true)
    expect(validateEntryBalance([{ accountId: 'a', debit: 10, credit: 0, description: '' }, { accountId: 'b', debit: 0, credit: 9.99, description: '' }])).toBe(false)
  })

  it('the trial balance view sums its classes to the cent', () => {
    const view = trialBalanceStatement('c', 'Société', {
      fiscalYear: { year: 2026 },
      period: { startDate: '2026-01-01', endDate: '2026-12-31' },
      balances: [
        { code: '601', label: 'Achats A', debit: 0.1, credit: 0, balance: 0.1 },
        { code: '602', label: 'Achats B', debit: 0.2, credit: 0, balance: 0.2 },
      ],
      totals: { debit: 0.3, credit: 0, balance: 0.3 },
    } as never)
    expect(view.sections[0].total?.values).toEqual([0.3, 0, 0.3])
  })
})

describe('rates sent by an assistant', () => {
  it('two decimals at most, never silently rounded', () => {
    expect(percentInput.safeParse(12.34).success).toBe(true)
    expect(percentInput.safeParse(100).success).toBe(true)
    const refused = percentInput.safeParse(12.345)
    expect(refused.success).toBe(false)
    expect(refused.error?.issues[0]?.message).toBe('Taux invalide : en pour cent avec deux décimales au plus.')
  })
})

describe('day arithmetic', () => {
  it('cash forecast helpers', () => {
    expect(Object.is(averageMonthlyChange([-1, 0, 0]), 0)).toBe(true)
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15')
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29')
    expect(daysInclusive('2026-03-01', '2026-03-31')).toBe(31)
    expect(daysInclusive('2026-03-02', '2026-03-01')).toBe(0)
  })

  it('due dates under payment terms', () => {
    expect(dueDateOf('2026-01-31', { days: 30, endOfMonth: false })).toBe('2026-03-02')
    expect(dueDateOf('2026-01-31', { days: 30, endOfMonth: true })).toBe('2026-03-31')
    expect(dueDateOf('2028-01-30', { days: 0, endOfMonth: true })).toBe('2028-01-31')
  })
})
