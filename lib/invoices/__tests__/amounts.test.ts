/**
 * Invoice amounts in cents (lib/invoices/amounts.ts): line totals rounded
 * half away from zero, VAT per rate on the sum of the line totals (CGI
 * ann. II art. 242 nonies A, I, 11°; EN 16931 BR-CO-17), allocation that
 * always sums to the total.
 */

import { describe, expect, it } from 'vitest'
import {
  allocateCents,
  computeInvoiceTotals,
  formatVatRate,
  isFrenchVatRate,
  lineTotalCents,
  parseQuantity,
  quantityToString,
  rateToBasisPoints,
  vatOnBaseCents,
} from '../amounts'

describe('quantities', () => {
  it('reads French and dotted decimals with three decimals at most', () => {
    expect(parseQuantity('2')).toBe(2000)
    expect(parseQuantity('1,5')).toBe(1500)
    expect(parseQuantity('0.125')).toBe(125)
    expect(parseQuantity(3)).toBe(3000)
    expect(parseQuantity(' 1 000,25 ')).toBe(1_000_250)
  })

  it('refuses a fourth decimal, negatives and text', () => {
    expect(parseQuantity('1.0001')).toBeNull()
    expect(parseQuantity('-1')).toBeNull()
    expect(parseQuantity('abc')).toBeNull()
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity(null)).toBeNull()
  })

  it('writes thousandths back without trailing zeros', () => {
    expect(quantityToString(1500)).toBe('1.5')
    expect(quantityToString(10_000)).toBe('10')
    expect(quantityToString(125)).toBe('0.125')
  })
})

describe('rates', () => {
  it('converts fractions (Qonto client invoices) and percentages (supplier invoices) to basis points', () => {
    expect(rateToBasisPoints('0.2', 'fraction')).toBe(2000)
    expect(rateToBasisPoints('0.055', 'fraction')).toBe(550)
    expect(rateToBasisPoints('0.021', 'fraction')).toBe(210)
    expect(rateToBasisPoints('20', 'percent')).toBe(2000)
    expect(rateToBasisPoints('5.5', 'percent')).toBe(550)
    expect(rateToBasisPoints('22.00', 'percent')).toBe(2200)
    expect(rateToBasisPoints('0', 'percent')).toBe(0)
  })

  it('refuses rates finer than a basis point or above 100 %', () => {
    expect(rateToBasisPoints('0.00001', 'fraction')).toBeNull()
    expect(rateToBasisPoints('5.555', 'percent')).toBeNull()
    expect(rateToBasisPoints('101', 'percent')).toBeNull()
    expect(rateToBasisPoints('abc', 'percent')).toBeNull()
  })

  it('knows the French rates (CGI art. 278 to 281 nonies, 296, 297)', () => {
    for (const rate of [2000, 1000, 550, 210, 850, 1300, 0]) expect(isFrenchVatRate(rate)).toBe(true)
    expect(isFrenchVatRate(2200)).toBe(false)
    expect(isFrenchVatRate(1960)).toBe(false)
  })

  it('formats rates the French way', () => {
    expect(formatVatRate(2000)).toBe('20 %')
    expect(formatVatRate(550)).toBe('5,5 %')
    expect(formatVatRate(210)).toBe('2,1 %')
    expect(formatVatRate(175)).toBe('1,75 %')
    expect(formatVatRate(0)).toBe('0 %')
  })
})

describe('rounding (half away from zero, to the cent)', () => {
  it('rounds a line total at half a cent up', () => {
    // 3 x 0,125 € is not possible in cents; 1,5 x 0,33 € = 0,495 € -> 0,50 €
    expect(lineTotalCents(1500, 33)).toBe(50)
    // 0,333 x 10,00 € = 3,33 €
    expect(lineTotalCents(333, 1000)).toBe(333)
    // 2,5 x 0,01 € = 0,025 € -> 0,03 €
    expect(lineTotalCents(2500, 1)).toBe(3)
  })

  it('rounds VAT at half a cent up', () => {
    expect(vatOnBaseCents(1, 5000)).toBe(1) // 0,005 -> 0,01
    expect(vatOnBaseCents(1234, 550)).toBe(68) // 0,6787 -> 0,68
    expect(vatOnBaseCents(1050, 2000)).toBe(210)
    expect(vatOnBaseCents(-1, 5000)).toBe(-1)
  })

  it('computes VAT per rate on the sum of the lines, not line by line', () => {
    // Three lines of 0,10 € at 5,5 %: line by line 3 x 0,01 € = 0,03 €; per rate 0,30 € x 5,5 % = 0,0165 -> 0,02 €
    const totals = computeInvoiceTotals([
      { quantityThousandths: 1000, unitPriceCents: 10, vatRateBp: 550 },
      { quantityThousandths: 1000, unitPriceCents: 10, vatRateBp: 550 },
      { quantityThousandths: 1000, unitPriceCents: 10, vatRateBp: 550 },
    ])
    expect(totals.breakdown).toEqual([{ vatRateBp: 550, baseCents: 30, vatCents: 2 }])
    expect(totals.totalInclTaxCents).toBe(32)
  })

  it('handles several rates on one invoice, highest rate first', () => {
    const totals = computeInvoiceTotals([
      { quantityThousandths: 2000, unitPriceCents: 4999, vatRateBp: 2000 }, // 99,98
      { quantityThousandths: 1000, unitPriceCents: 1234, vatRateBp: 550 }, // 12,34
      { quantityThousandths: 3000, unitPriceCents: 333, vatRateBp: 1000 }, // 9,99
      { quantityThousandths: 1000, unitPriceCents: 500, vatRateBp: 2000 }, // 5,00
    ])
    expect(totals.lineTotalsCents).toEqual([9998, 1234, 999, 500])
    expect(totals.breakdown).toEqual([
      { vatRateBp: 2000, baseCents: 10498, vatCents: 2100 }, // 20,996 -> 21,00
      { vatRateBp: 1000, baseCents: 999, vatCents: 100 }, // 0,999 -> 1,00
      { vatRateBp: 550, baseCents: 1234, vatCents: 68 },
    ])
    expect(totals.totalExclTaxCents).toBe(12731)
    expect(totals.totalVatCents).toBe(2268)
    expect(totals.totalInclTaxCents).toBe(14999)
  })

  it('keeps large amounts exact', () => {
    const totals = computeInvoiceTotals([{ quantityThousandths: 1_000_000, unitPriceCents: 999_999_99, vatRateBp: 2000 }])
    expect(totals.totalExclTaxCents).toBe(99_999_999_000)
    expect(totals.totalVatCents).toBe(19_999_999_800)
  })
})

describe('allocation', () => {
  it('sums to the total, the remainder to the largest weight', () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocateCents(100, [1, 2, 1])).toEqual([25, 50, 25])
    expect(allocateCents(101, [1, 3])).toEqual([25, 76])
    expect(allocateCents(7, [0, 0])).toEqual([7, 0])
    expect(allocateCents(0, [5, 5])).toEqual([0, 0])
    const parts = allocateCents(9999, [333, 333, 334])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(9999)
  })
})
