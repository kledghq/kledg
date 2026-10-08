/**
 * Recoverable VAT of expense lines (lib/expense-reports/vat-recovery.ts).
 * Sources checked by each case:
 * - CGI art. 271, II, 1, a and CGI ann. II art. 242 nonies A: VAT is
 *   deducted on an invoice made out to the company;
 * - BOI-TVA-DECLA-30-20-20-20, § 130 to 150: a detailed receipt of 150 € HT
 *   at most is accepted;
 * - CGI ann. II art. 206, IV, 2 (version in force since 8 July 2024): 2°
 *   lodging of dirigeants and staff, 3° gifts (73 € TTC per beneficiary and
 *   per year, CGI ann. IV art. 28-00 A), 5° passenger transport;
 * - CGI art. 298, 4, 1°, a: 80 % of the VAT on fuel of passenger cars;
 * - CGI art. 293 B: no deduction under the VAT franchise.
 */

import { describe, expect, it } from 'vitest'
import { recoverableVat, vatIncludedCents, SIMPLIFIED_RECEIPT_MAX_EXCL_TAX_CENTS, GIFT_MAX_INCL_TAX_CENTS } from '../vat-recovery'

const base = { receiptKind: 'INVOICE' as const, vatExempt: false }

describe('recoverable VAT of an expense line', () => {
  it('recovers the whole VAT of a meal or supplies with an invoice in the company name (CGI art. 271, II, 1, a)', () => {
    expect(recoverableVat({ ...base, category: 'RECEPTION', amountInclTaxCents: 11_000, vatCents: 1_000 })).toEqual({ recoverableVatCents: 1_000, reason: 'full' })
    expect(recoverableVat({ ...base, category: 'SUPPLIES', amountInclTaxCents: 2_400, vatCents: 400 })).toEqual({ recoverableVatCents: 400, reason: 'full' })
  })

  it('accepts a detailed receipt up to 150 € HT, refuses it above (BOI-TVA-DECLA-30-20-20-20, § 130 to 150)', () => {
    expect(SIMPLIFIED_RECEIPT_MAX_EXCL_TAX_CENTS).toBe(15_000)
    // 165 € TTC at 10 %: 150 € HT exactly, accepted
    expect(recoverableVat({ ...base, receiptKind: 'RECEIPT', category: 'MEALS', amountInclTaxCents: 16_500, vatCents: 1_500 }).recoverableVatCents).toBe(1_500)
    // 165,11 € TTC: 150,01 € HT, an invoice is needed
    expect(recoverableVat({ ...base, receiptKind: 'RECEIPT', category: 'MEALS', amountInclTaxCents: 16_511, vatCents: 1_510 })).toEqual({ recoverableVatCents: 0, reason: 'receipt-over-150' })
    expect(recoverableVat({ ...base, receiptKind: 'INVOICE', category: 'MEALS', amountInclTaxCents: 16_511, vatCents: 1_510 }).recoverableVatCents).toBe(1_510)
  })

  it('recovers nothing without a receipt', () => {
    expect(recoverableVat({ ...base, receiptKind: 'NONE', category: 'SUPPLIES', amountInclTaxCents: 1_200, vatCents: 200 })).toEqual({ recoverableVatCents: 0, reason: 'no-receipt' })
  })

  it('never recovers the VAT of passenger transport (CGI ann. II art. 206, IV, 2, 5°), even with an invoice', () => {
    expect(recoverableVat({ ...base, category: 'TRANSPORT', amountInclTaxCents: 8_800, vatCents: 800 })).toEqual({ recoverableVatCents: 0, reason: 'passenger-transport' })
  })

  it('never recovers the VAT of lodging dirigeants or staff (CGI ann. II art. 206, IV, 2, 2°)', () => {
    expect(recoverableVat({ ...base, category: 'LODGING', amountInclTaxCents: 13_200, vatCents: 1_200 })).toEqual({ recoverableVatCents: 0, reason: 'staff-lodging' })
  })

  it('recovers the VAT of a gift up to 73 € TTC only (CGI ann. II art. 206, IV, 2, 3°; CGI ann. IV art. 28-00 A)', () => {
    expect(GIFT_MAX_INCL_TAX_CENTS).toBe(7_300)
    expect(recoverableVat({ ...base, category: 'GIFTS', amountInclTaxCents: 7_300, vatCents: 1_217 }).recoverableVatCents).toBe(1_217)
    expect(recoverableVat({ ...base, category: 'GIFTS', amountInclTaxCents: 7_301, vatCents: 1_217 })).toEqual({ recoverableVatCents: 0, reason: 'gift-over-73' })
  })

  it('recovers 80 % of the VAT on the fuel of a passenger car, rounded to the cent (CGI art. 298, 4, 1°, a)', () => {
    expect(recoverableVat({ ...base, category: 'FUEL', amountInclTaxCents: 6_000, vatCents: 1_000 })).toEqual({ recoverableVatCents: 800, reason: 'fuel-80' })
    // 80 % of 12,33 € = 9,864 -> 9,86 €; of 0,13 € = 0,104 -> 0,10 €; of 0,07 € = 0,056 -> 0,06 €
    expect(recoverableVat({ ...base, category: 'FUEL', amountInclTaxCents: 7_398, vatCents: 1_233 }).recoverableVatCents).toBe(986)
    expect(recoverableVat({ ...base, category: 'FUEL', amountInclTaxCents: 78, vatCents: 13 }).recoverableVatCents).toBe(10)
    expect(recoverableVat({ ...base, category: 'FUEL', amountInclTaxCents: 42, vatCents: 7 }).recoverableVatCents).toBe(6)
  })

  it('recovers nothing under the VAT franchise (CGI art. 293 B), nor on a mileage allowance or a line without VAT', () => {
    expect(recoverableVat({ ...base, vatExempt: true, category: 'SUPPLIES', amountInclTaxCents: 1_200, vatCents: 200 }).reason).toBe('franchise')
    expect(recoverableVat({ ...base, mileage: true, category: 'MILEAGE', amountInclTaxCents: 5_290, vatCents: 0 }).reason).toBe('no-vat')
    expect(recoverableVat({ ...base, category: 'POSTAGE', amountInclTaxCents: 1_000, vatCents: 0 }).reason).toBe('no-vat')
  })

  it('computes the VAT included in an amount at a rate, rounded half away from zero', () => {
    expect(vatIncludedCents(12_000, 2000)).toBe(2_000)
    expect(vatIncludedCents(11_000, 1000)).toBe(1_000)
    // 10,55 € at 5,5 %: 0,55 €
    expect(vatIncludedCents(1_055, 550)).toBe(55)
    // 1,00 € at 20 %: 0,1666 -> 0,17 €
    expect(vatIncludedCents(100, 2000)).toBe(17)
    expect(vatIncludedCents(1_000, 0)).toBe(0)
  })
})

// R3 QUAL-14: a toll or a parking ticket is not passenger transport; its VAT
// is deductible by the user (BOI-TVA-DED-40-40, § 30 and § 330), in an
// expense report as in simple mode (category peages-parking).
describe('tolls and parking', () => {
  it('a 12 € toll at 20 % recovers its 2 € of VAT, as simple mode does', async () => {
    const { findCategory } = await import('@/lib/simple/categories')
    const { buildPostingLines } = await import('@/lib/simple/posting')
    const expense = recoverableVat({ category: 'TOLLS_PARKING', receiptKind: 'RECEIPT', amountInclTaxCents: 1_200, vatCents: 200, vatExempt: false })
    expect(expense).toEqual({ recoverableVatCents: 200, reason: 'full' })
    const category = findCategory('peages-parking')!
    expect(buildPostingLines({ category, posting: category.posting, side: 'debit', amountCents: 1_200, recoveryRatio: null }).vatBookedCents).toBe(200)
    // Train, plane and taxi stay excluded (CGI ann. II art. 206, IV, 2, 5°)
    expect(recoverableVat({ category: 'TRANSPORT', receiptKind: 'RECEIPT', amountInclTaxCents: 1_100, vatCents: 100, vatExempt: false }).recoverableVatCents).toBe(0)
  })
})
