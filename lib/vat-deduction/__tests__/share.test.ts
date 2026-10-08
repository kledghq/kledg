/**
 * The deducted part of a VAT and of a self-assessed VAT (lib/vat-deduction/share.ts):
 * CGI ann. II art. 205 (deduction at the coefficient de déduction), CGI art.
 * 283, 2 and 256 bis (self-assessed VAT due in full by the company).
 */

import { describe, expect, it } from 'vitest'
import { deductibleVatCents, selfAssessedSplit } from '../share'

describe('deduction at the coefficient de déduction', () => {
  it('worked example: 1 000 € of US services, 20 % self-assessed, coefficient 60 %', () => {
    // 200 € due on 4452, 120 € deducted on 44566, 80 € added to the charge
    expect(selfAssessedSplit(20_000, 0.6)).toEqual({ dueCents: 20_000, deductibleCents: 12_000, nonDeductibleCents: 8_000 })
  })

  it('full deduction without a coefficient; a franchise owes the VAT and deducts none', () => {
    expect(selfAssessedSplit(20_000, null)).toEqual({ dueCents: 20_000, deductibleCents: 20_000, nonDeductibleCents: 0 })
    expect(selfAssessedSplit(20_000, 0)).toEqual({ dueCents: 20_000, deductibleCents: 0, nonDeductibleCents: 20_000 })
  })

  it('rounds half up to the cent, as purchase invoices do', () => {
    // 1 001 x 45 % = 450,45 gives 450; 1 001 x 55 % = 550,55 gives 551
    expect(deductibleVatCents(1_001, 0.45)).toBe(450)
    expect(deductibleVatCents(1_001, 0.55)).toBe(551)
    expect(deductibleVatCents(0, 0.5)).toBe(0)
  })
})
