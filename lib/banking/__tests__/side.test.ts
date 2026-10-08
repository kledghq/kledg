/** KLEDG-R3-QUAL-19: the one reading of a bank transaction side. */
import { describe, expect, it } from 'vitest'
import { isDebitSide, normalizeBankSide, signedBankCents } from '@/lib/banking/side'

describe('normalizeBankSide', () => {
  it.each([
    ['debit', 'debit'],
    ['DEBIT', 'debit'],
    ['Débit', 'debit'],
    [' d', 'debit'],
    ['credit', 'credit'],
    ['Crédit', 'credit'],
    ['', 'credit'],
    [null, 'credit'],
  ] as const)('%s is %s', (raw, side) => {
    expect(normalizeBankSide(raw)).toBe(side)
    expect(isDebitSide(raw)).toBe(side === 'debit')
  })

  it('signs absolute cents by side', () => {
    expect(signedBankCents(1234, 'debit')).toBe(-1234)
    expect(signedBankCents(-1234, 'credit')).toBe(1234)
  })
})
