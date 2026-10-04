/**
 * Opening balances: the opening balance sheet equals the previous closing
 * one (Code de commerce art. L123-19, al. 3; PCG art. 112-2), on balance
 * sheet accounts only, balanced to the cent.
 */

import { describe, expect, it } from 'vitest'
import { checkOpeningLines, OPENING_PRESETS } from '../opening-lines'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'

describe('checkOpeningLines', () => {
  it('accepts a balanced opening balance sheet', () => {
    const check = checkOpeningLines([
      { accountCode: '512', debitCents: 1_250_000, creditCents: 0 },
      { accountCode: '411', debitCents: 250_050, creditCents: 0 },
      { accountCode: '1013', debitCents: 0, creditCents: 100_000 },
      { accountCode: '120', debitCents: 0, creditCents: 1_400_050 },
      { accountCode: '401', debitCents: 0, creditCents: 0 },
    ])
    expect(check.errors).toEqual([])
    expect(check.debitCents).toBe(1_500_050)
    expect(check.creditCents).toBe(1_500_050)
  })

  it('refuses an unbalanced entry, to the cent', () => {
    const check = checkOpeningLines([
      { accountCode: '512', debitCents: 100_001, creditCents: 0 },
      { accountCode: '1013', debitCents: 0, creditCents: 100_000 },
    ])
    expect(check.errors.join(' ')).toMatch(/équilibré/)
  })

  it('refuses income statement accounts (classes 6 and 7) and bad codes', () => {
    const check = checkOpeningLines([
      { accountCode: '706', debitCents: 0, creditCents: 100 },
      { accountCode: '512', debitCents: 100, creditCents: 0 },
    ])
    expect(check.errors[0]).toMatch(/706 n'est pas un compte de bilan/)
    expect(checkOpeningLines([
      { accountCode: 'abc', debitCents: 100, creditCents: 0 },
      { accountCode: '512', debitCents: 0, creditCents: 100 },
    ]).errors[0]).toMatch(/pas un compte de bilan/)
  })

  it('refuses a line with both sides, a duplicate account and fewer than two amounts', () => {
    expect(checkOpeningLines([
      { accountCode: '512', debitCents: 100, creditCents: 100 },
      { accountCode: '1013', debitCents: 0, creditCents: 0 },
    ]).errors.join(' ')).toMatch(/soit au débit, soit au crédit.*au moins deux soldes/)
    expect(checkOpeningLines([
      { accountCode: '512', debitCents: 100, creditCents: 0 },
      { accountCode: '512', debitCents: 0, creditCents: 100 },
    ]).errors[0]).toMatch(/apparaît deux fois/)
  })

  it('offers presets on accounts that every new chart of accounts has', () => {
    const codes = new Set(PCG_ACCOUNTS.filter((a) => a.code.length <= 4).map((a) => a.code))
    for (const preset of OPENING_PRESETS) {
      expect(codes.has(preset.accountCode), preset.accountCode).toBe(true)
      expect(Number(preset.accountCode[0])).toBeLessThanOrEqual(5)
    }
  })
})
