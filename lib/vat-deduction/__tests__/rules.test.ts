/**
 * Coefficient de déduction (CGI ann. II art. 205 to 207; BOI-TVA-DED-20-10-20,
 * BOI-TVA-DED-20-10-40, BOI-TVA-DED-60-10; notices 3310-CA3-SD and
 * 3517-S-SD 2026) and the reading of revenue for the coefficient de taxation.
 */

import { describe, expect, it } from 'vitest'
import {
  deductionPercent,
  incurredFromDeducted,
  percentOf,
  provisionalTaxation,
  regularisationCents,
  regularisationDeadline,
  regularisationLine,
  regularisationReference,
  roundUpPercent,
} from '../rules'
import { classifyAccount, settingFor, summarizeRevenue, type RevenueAccountRow } from '../revenue'

const row = (code: string, totalCents: number, over: Partial<RevenueAccountRow> = {}): RevenueAccountRow => ({
  code,
  label: code,
  totalCents,
  withVatCents: 0,
  exemptInvoiceCents: 0,
  exemptInVatEntriesCents: 0,
  ...over,
})

describe('rounding up to the whole percent (art. 206, V, 2)', () => {
  it('rounds every ratio up, as BOFiP: 0,5333 gives 54 %', () => {
    expect(roundUpPercent(5_333, 10_000)).toBe(54)
    expect(roundUpPercent(150, 200)).toBe(75)
    expect(roundUpPercent(1, 1_000_000)).toBe(1)
    expect(roundUpPercent(999_999, 1_000_000)).toBe(100)
  })

  it('has no coefficient without turnover, never above 100 or below 0', () => {
    expect(roundUpPercent(0, 0)).toBeNull()
    expect(roundUpPercent(500, 400)).toBe(100)
    expect(roundUpPercent(-5, 400)).toBe(0)
  })

  it('rounds the product up again: 66 % x 84 % = 55,44 % gives 56 % (BOI-TVA-DED-20-10-40 §1)', () => {
    expect(deductionPercent(66, 84)).toBe(56)
    expect(deductionPercent(100, 54)).toBe(54)
    expect(deductionPercent(100, 100, 80)).toBe(80)
    expect(deductionPercent(0, 75)).toBe(0)
  })
})

describe('provisional and definitive coefficients', () => {
  it('takes the definitive coefficient of the year before (BOI-TVA-DED-20-10-40, example 3)', () => {
    expect(provisionalTaxation({ previousYearPercent: 40, estimatePercent: 70, yearToDatePercent: 90 })).toEqual({ percent: 40, source: 'previous-year' })
  })

  it('takes the estimate of a first year, else the books to date until one is entered', () => {
    expect(provisionalTaxation({ previousYearPercent: null, estimatePercent: 70, yearToDatePercent: 90 })).toEqual({ percent: 70, source: 'estimate' })
    expect(provisionalTaxation({ previousYearPercent: null, estimatePercent: null, yearToDatePercent: 90 })).toEqual({ percent: 90, source: 'books-to-date' })
    expect(provisionalTaxation({ previousYearPercent: null, estimatePercent: null, yearToDatePercent: null })).toEqual({ percent: 0, source: 'books-to-date' })
  })

  it('regularises the BOFiP example: 784 € x 50 % less 352,80 € deducted at 45 % is 39,20 €', () => {
    // BOI-TVA-DED-20-10-40, example 3: "784 x 0,5 - 352,80 = 39,20 €"
    expect(regularisationCents(78_400, 35_280, 50)).toBe(3_920)
    expect(incurredFromDeducted(35_280, 45)).toBe(78_400)
  })

  it('pays back VAT when the definitive coefficient is lower, whatever the size (BOI-TVA-DED-20-10-20 §460)', () => {
    expect(regularisationCents(10_000, 6_000, 59)).toBe(-100)
    expect(regularisationCents(10_000, 6_000, 60)).toBe(0)
    expect(percentOf(-333, 50)).toBe(-167)
  })

  it('cannot derive the VAT borne from a coefficient of 0', () => {
    expect(incurredFromDeducted(0, 0)).toBeNull()
    expect(incurredFromDeducted(12_345, 100)).toBe(12_345)
  })

  it('is set before 25 April of the following year, on CA3 line 21 or 15 (CA12 line 25 or 18)', () => {
    expect(regularisationDeadline(2026)).toBe('2027-04-24')
    expect(regularisationReference(2026)).toBe('COEF-TVA-2026')
    expect(regularisationLine('CA3', 3_920)).toEqual({ code: '21', box: '0059', label: 'Autre TVA à déduire' })
    expect(regularisationLine('CA3', -100)).toEqual({ code: '15', box: '0600', label: 'TVA antérieurement déduite à reverser' })
    expect(regularisationLine('CA12', 1).code).toBe('25')
    expect(regularisationLine('CA12', -1).code).toBe('18')
  })
})

describe('revenue of the coefficient de taxation (BOI-TVA-DED-20-10-20 §90 to §150)', () => {
  it('reads taxed sales from the collected VAT and exempt training from invoice lines', () => {
    const account = classifyAccount(row('706100', 100_000, { withVatCents: 60_000, exemptInvoiceCents: 30_000 }), [])
    expect(account).toMatchObject({ source: 'books', taxableCents: 60_000, exemptCents: 30_000, toClassifyCents: 10_000 })
  })

  it('takes the exempt lines of a mixed invoice out of the taxed revenue', () => {
    const account = classifyAccount(row('706', 100_000, { withVatCents: 100_000, exemptInvoiceCents: 40_000, exemptInVatEntriesCents: 40_000 }), [])
    expect(account).toMatchObject({ taxableCents: 60_000, exemptCents: 40_000, toClassifyCents: 0 })
  })

  it('leaves accounts 71 to 79 out of both terms by default (fixed asset disposals, subsidies, financial income)', () => {
    expect(classifyAccount(row('775000', 50_000), [])).toMatchObject({ source: 'default-excluded', excludedCents: 50_000 })
    expect(classifyAccount(row('768', 1_000), [])).toMatchObject({ excludedCents: 1_000 })
  })

  it('follows the setting of the account or its longest root', () => {
    const settings = [
      { accountCode: '706', vatTreatment: 'exempt' as const },
      { accountCode: '7062', vatTreatment: 'taxable' as const },
      { accountCode: '74', vatTreatment: 'taxable' as const },
    ]
    expect(settingFor('706200', settings)?.accountCode).toBe('7062')
    expect(classifyAccount(row('706100', 9_000, { withVatCents: 9_000 }), settings)).toMatchObject({ source: 'setting', exemptCents: 9_000, taxableCents: 0 })
    expect(classifyAccount(row('706200', 5_000), settings)).toMatchObject({ taxableCents: 5_000, setting: { accountCode: '7062', treatment: 'taxable' } })
    expect(classifyAccount(row('740000', 2_000), settings)).toMatchObject({ taxableCents: 2_000 })
  })

  it('sums the coefficient: exempt and unclassified sales in the denominator only', () => {
    const summary = summarizeRevenue(
      [row('706100', 60_000, { withVatCents: 60_000 }), row('706200', 30_000, { exemptInvoiceCents: 30_000 }), row('707', 10_000), row('775', 99_000)],
      [],
    )
    expect(summary).toMatchObject({ taxableCents: 60_000, exemptCents: 30_000, toClassifyCents: 10_000, excludedCents: 99_000, numeratorCents: 60_000, denominatorCents: 100_000 })
    expect(roundUpPercent(summary.numeratorCents, summary.denominatorCents)).toBe(60)
  })

  it('counts a negative balance (credit notes above sales) as nothing', () => {
    expect(classifyAccount(row('706', -5_000), [])).toMatchObject({ taxableCents: 0, exemptCents: 0, toClassifyCents: 0 })
  })
})

// R3 QUAL-02: the regularisation compares the definitive coefficient with
// the VAT actually deducted, not with the provisional coefficient recomputed
// at the end of the year (CGI ann. II art. 207, I).
describe('regularisation against the coefficient actually applied', () => {
  it('first year without an estimate: 1 000 € deducted at 100 % early in the year, definitive 60 %: 400 € to pay back', () => {
    const definitive = deductionPercent(100, 60)
    // The VAT borne cannot be read back from the books (the coefficient moved): entered, 1 000 €
    expect(regularisationCents(100_000, 100_000, definitive)).toBe(-40_000)
  })

  it('an estimate changed mid-year: 500 € deducted at 80 %, then 300 € at 50 %, definitive 55 %', () => {
    // VAT borne entered: 625 € + 600 € = 1 225 €; deducted 800 €; 1 225 x 55 % = 673,75 €
    expect(regularisationCents(122_500, 80_000, 55)).toBe(67_375 - 80_000)
  })
})
