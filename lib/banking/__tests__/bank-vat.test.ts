/**
 * The VAT a bank read on a receipt: one reading and one plausibility rule
 * for simple mode and the assignment rules (lib/banking/bank-vat.ts).
 * R3 QUAL-12: the rule engine accepted any amount (150 € of VAT on a 100 €
 * payment made the charge a credit) while simple mode ignored it; a zero
 * read meant "no VAT" for a rule and "unknown" for simple mode.
 */

import { describe, expect, it } from 'vitest'
import { bankVatCentsOf, bankVatInEuros, bankVatOf, readBankVat, trustedBankVatCents } from '../bank-vat'
import { findCategory } from '@/lib/simple/categories'
import { buildPostingLines } from '@/lib/simple/posting'
import { calculateAmountsWithVAT } from '@/lib/transactions/entry-line-calculator'

const ruleLine = { amountType: 'full', lineType: 'debit', vatType: 'deductible', vatRateSource: 'transaction', vatRate: 20 }

/** What simple mode books for a material purchase, from the transaction as stored. */
function simpleVat(tx: { amount: string; vatRate: string | null; vatAmount: string | null; providerData?: unknown }) {
  const amountCents = Math.round(Math.abs(Number(tx.amount)) * 100)
  const category = findCategory('materiel-informatique')!
  return buildPostingLines({ category, posting: category.posting, side: 'debit', amountCents, bankVatCents: bankVatCentsOf(tx), recoveryRatio: null }).vatCents
}

/** What a rule with the bank's VAT (20 % when it reads nothing) books, from the same transaction. */
function ruleVat(tx: { amount: string; vatRate: string | null; vatAmount: string | null; providerData?: unknown }) {
  const amount = Math.abs(Number(tx.amount))
  return Math.round(calculateAmountsWithVAT(ruleLine, amount, bankVatInEuros(tx, Math.round(amount * 100))).vatAmount * 100)
}

describe('reading', () => {
  it('reads the columns first, then the provider payload; a negative rate is no rate', () => {
    expect(readBankVat({ vatRate: '20', vatAmount: '2.00' })).toEqual({ ratePercent: 20, amountCents: 200 })
    expect(readBankVat({ vatRate: null, vatAmount: null, providerData: { vat_amount: 1.5 } })).toEqual({ ratePercent: null, amountCents: 150 })
    expect(readBankVat({ vatRate: null, vatAmount: null, providerData: { vat_amount_cents: 250 } })).toEqual({ ratePercent: null, amountCents: 250 })
    expect(readBankVat({ vatRate: '-1', vatAmount: null })).toBeNull()
  })

  it('trusts an amount up to 20 % of the base (one cent of rounding), zero only with a rate of 0 %', () => {
    expect(trustedBankVatCents(12_000, { ratePercent: null, amountCents: 2_000 })).toBe(2_000)
    expect(trustedBankVatCents(12_001, { ratePercent: null, amountCents: 2_001 })).toBe(2_001)
    expect(trustedBankVatCents(12_000, { ratePercent: null, amountCents: 2_001 })).toBeNull()
    expect(trustedBankVatCents(10_000, { ratePercent: null, amountCents: 15_000 })).toBeNull()
    expect(trustedBankVatCents(10_000, { ratePercent: 0, amountCents: 0 })).toBe(0)
    expect(trustedBankVatCents(10_000, { ratePercent: null, amountCents: 0 })).toBeNull()
    expect(bankVatOf({ vatRate: '55', vatAmount: null }, 10_000)).toBeNull()
  })
})

describe('simple mode and the rules book the same VAT (R3 QUAL-12)', () => {
  it('a VAT above the amount (OCR error) is ignored by both: 20 % of 100 € TTC is 16,67 €', () => {
    const tx = { amount: '-100.00', vatRate: null, vatAmount: '150.00' }
    expect(ruleVat(tx)).toBe(1_667)
    expect(simpleVat(tx)).toBe(1_667)
    expect(calculateAmountsWithVAT(ruleLine, 100, { vatRate: null, vatAmount: 150 }).amountHT).toBeCloseTo(83.33, 2)
  })

  it('a zero read with a rate of 0 %: no VAT in both', () => {
    const tx = { amount: '-100.00', vatRate: '0', vatAmount: '0' }
    expect(ruleVat(tx)).toBe(0)
    expect(simpleVat(tx)).toBe(0)
  })

  it('a zero read without a rate: the receipt was not read, 20 % in both', () => {
    const tx = { amount: '-100.00', vatRate: null, vatAmount: '0' }
    expect(ruleVat(tx)).toBe(1_667)
    expect(simpleVat(tx)).toBe(1_667)
  })

  it('a plausible VAT read: used by both', () => {
    const tx = { amount: '-47.99', vatRate: '20', vatAmount: '8.00' }
    expect(ruleVat(tx)).toBe(800)
    expect(simpleVat(tx)).toBe(800)
  })
})
