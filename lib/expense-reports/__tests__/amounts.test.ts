/**
 * Amounts of an expense report (lib/expense-reports/amounts.ts), the
 * keyword rules of categories (category-rules.ts) and the derived status
 * (status.ts), on plain values.
 */

import { describe, expect, it } from 'vitest'
import { assignPriorDistances, computeLine, computeReport, vehicleKey, type LineInput } from '../amounts'
import { matchCategoryRule, normalizeText, type CategoryRule } from '../category-rules'
import { expenseReportStatus } from '../status'

const expense = (over: Partial<LineInput> = {}): LineInput => ({
  kind: 'EXPENSE',
  date: '2026-03-10',
  category: 'RECEPTION',
  amountInclTaxCents: 11_000,
  vatRateBp: 1000,
  vatCents: null,
  receiptKind: 'INVOICE',
  ...over,
})
const trip = (over: Partial<LineInput> = {}): LineInput => ({
  kind: 'MILEAGE',
  date: '2026-03-12',
  category: 'MILEAGE',
  amountInclTaxCents: 0,
  vatRateBp: 0,
  vatCents: null,
  receiptKind: 'NONE',
  vehicleType: 'CAR',
  fiscalPower: 5,
  electric: false,
  distanceKm: 100,
  ...over,
})
const company = { vatExempt: false }

describe('expense line amounts', () => {
  it('computes the VAT from the amount when it is not typed, and the charge as TTC minus the recoverable VAT', () => {
    expect(computeLine(expense(), company)).toMatchObject({ amountInclTaxCents: 11_000, vatCents: 1_000, recoverableVatCents: 1_000, expenseCents: 10_000, error: null })
    // Train ticket: VAT 10 % shown but not recoverable, the whole ticket is a charge
    expect(computeLine(expense({ category: 'TRANSPORT' }), company)).toMatchObject({ vatCents: 1_000, recoverableVatCents: 0, expenseCents: 11_000, reason: 'passenger-transport' })
  })

  it('accepts a typed VAT within 2 cents of the rate, and explains a wrong one', () => {
    expect(computeLine(expense({ vatCents: 1_002 }), company)).toMatchObject({ vatCents: 1_002, error: null })
    const wrong = computeLine(expense({ vatCents: 1_500 }), company)
    expect(wrong.error).toMatch(/ne correspond pas au taux/)
    expect(wrong.recoverableVatCents).toBe(0)
    expect(computeLine(expense({ vatRateBp: 0, vatCents: 100 }), company).error).toMatch(/sans taux de TVA/)
    expect(computeLine(expense({ amountInclTaxCents: 100, vatRateBp: 2000, vatCents: 200 }), company).error).toMatch(/dépasse/)
  })

  it('pays a trip by the scale without VAT', () => {
    expect(computeLine(trip(), company)).toMatchObject({ amountInclTaxCents: 6_360, vatCents: 0, recoverableVatCents: 0, expenseCents: 6_360, scaleYear: 2026, powerClass: '5 CV', error: null })
    expect(computeLine(trip({ date: '2030-01-05' }), company).error).toMatch(/barème kilométrique 2030/)
  })

  it('totals a report: owed = charges + recoverable VAT, the VAT per rate highest first', () => {
    const totals = computeReport(
      [expense(), expense({ category: 'SUPPLIES', amountInclTaxCents: 2_400, vatRateBp: 2000 }), expense({ category: 'LODGING', amountInclTaxCents: 13_200 }), trip()],
      company,
    )
    expect(totals.totalInclTaxCents).toBe(11_000 + 2_400 + 13_200 + 6_360)
    expect(totals.recoverableVatCents).toBe(1_000 + 400)
    expect(totals.totalExpenseCents + totals.recoverableVatCents).toBe(totals.totalInclTaxCents)
    expect(totals.vatByRate).toEqual([
      { vatRateBp: 2000, recoverableVatCents: 400 },
      { vatRateBp: 1000, recoverableVatCents: 1_000 },
    ])
  })

  it('recovers nothing for a company under the VAT franchise', () => {
    expect(computeReport([expense()], { vatExempt: true }).recoverableVatCents).toBe(0)
  })

  it('counts the annual distance per vehicle: baseline, then earlier trips by date', () => {
    const lines = [trip({ date: '2026-03-20', distanceKm: 300 }), trip({ date: '2026-03-02', distanceKm: 200 }), trip({ date: '2026-03-05', fiscalPower: 7, distanceKm: 50 })]
    const key = vehicleKey(lines[0])
    expect(key).toBe('2026:CAR:5:t')
    const assigned = assignPriorDistances(lines, { [key]: 4_600 })
    expect(assigned.map((l) => l.priorDistanceKm)).toEqual([4_800, 4_600, 0])
    // The trip of the 20th crosses 5 000 km: scale(5100) - scale(4800)
    // = (5100 x 0,357 + 1395) - 4800 x 0,636 = 3215,70 - 3052,80 = 162,90 €
    expect(computeLine(assigned[0], company).amountInclTaxCents).toBe(16_290)
    // Another year starts from zero
    expect(vehicleKey(trip({ date: '2027-01-02' }))).toBe('2027:CAR:5:t')
  })
})

describe('category rules', () => {
  const rules: CategoryRule[] = [
    { id: 'r1', keyword: 'SNCF', category: 'TRANSPORT', accountCode: null, priority: 0 },
    { id: 'r2', keyword: 'hôtel', category: 'LODGING', accountCode: '6256', priority: 0 },
    { id: 'r3', keyword: 'total', category: 'FUEL', accountCode: null, priority: 0 },
    { id: 'r4', keyword: 'totalenergies', category: 'FUEL', accountCode: '6061', priority: 0 },
    { id: 'r5', keyword: 'restaurant', category: 'RECEPTION', accountCode: null, priority: 5 },
  ]

  it('matches a keyword without case nor accents in the supplier or the label', () => {
    expect(normalizeText('  Hôtel   ÉTOILE ')).toBe('hotel etoile')
    expect(matchCategoryRule(rules, { supplierName: 'Sncf Voyageurs', label: 'Billet' })?.id).toBe('r1')
    expect(matchCategoryRule(rules, { supplierName: null, label: 'Nuit HOTEL du Port' })?.id).toBe('r2')
    expect(matchCategoryRule(rules, { supplierName: 'Papeterie', label: 'Stylos' })).toBeNull()
  })

  it('prefers the highest priority, then the longest keyword', () => {
    expect(matchCategoryRule(rules, { supplierName: 'TotalEnergies Lyon', label: '' })?.id).toBe('r4')
    expect(matchCategoryRule(rules, { supplierName: 'Restaurant de la gare SNCF', label: '' })?.id).toBe('r5')
  })
})

describe('expense report status', () => {
  it('derives comptabilisée and remboursée from the entry and its lettering', () => {
    expect(expenseReportStatus({ status: 'DRAFT', posted: false, lettered: false })).toBe('draft')
    expect(expenseReportStatus({ status: 'SUBMITTED', posted: false, lettered: false })).toBe('submitted')
    expect(expenseReportStatus({ status: 'VALIDATED', posted: false, lettered: false })).toBe('validated')
    expect(expenseReportStatus({ status: 'VALIDATED', posted: true, lettered: false })).toBe('posted')
    expect(expenseReportStatus({ status: 'VALIDATED', posted: true, lettered: true })).toBe('reimbursed')
  })
})

// R3 QUAL-07: a partly exempt company recovers the share of its coefficient
// de déduction (CGI ann. II art. 205 and 206), as purchase invoices do.
describe('coefficient de déduction', () => {
  it('coefficient 40 %: 120 € TTC of supplies at 20 % recovers 8 € of the 20 €, the rest is charge', () => {
    const line = expense({ category: 'SUPPLIES', amountInclTaxCents: 12_000, vatRateBp: 2000, deductionPercent: 40 })
    expect(computeLine(line, company)).toMatchObject({ vatCents: 2_000, recoverableVatCents: 800, expenseCents: 11_200, reason: 'coefficient' })
    // Half up on the cent, as lib/invoices/posting-plan.ts: 1 001 x 45 % = 450,45 gives 450
    expect(computeLine(expense({ category: 'SUPPLIES', amountInclTaxCents: 6_006, vatRateBp: 2000, vatCents: 1_001, deductionPercent: 45 }), company).recoverableVatCents).toBe(450)
    const report = computeReport([line, expense({ category: 'SUPPLIES', amountInclTaxCents: 6_000, vatRateBp: 2000, deductionPercent: 40 })], company)
    expect(report).toMatchObject({ totalInclTaxCents: 18_000, recoverableVatCents: 1_200, totalExpenseCents: 16_800 })
  })

  it('applies after the exclusions: passenger transport stays at 0, fuel at 80 % then the coefficient', () => {
    expect(computeLine(expense({ category: 'TRANSPORT', deductionPercent: 40 }), company)).toMatchObject({ recoverableVatCents: 0, reason: 'passenger-transport' })
    // Fuel 120 € TTC: 20 € of VAT, 16 € at 80 %, 6,40 € at 40 %
    expect(computeLine(expense({ category: 'FUEL', amountInclTaxCents: 12_000, vatRateBp: 2000, deductionPercent: 40 }), company).recoverableVatCents).toBe(640)
  })

  it('a coefficient of 100 % or none changes nothing; the franchise of the day recovers nothing', () => {
    expect(computeLine(expense({ deductionPercent: 100 }), company)).toMatchObject({ recoverableVatCents: 1_000, reason: 'full' })
    expect(computeLine(expense({ deductionPercent: null }), company)).toMatchObject({ recoverableVatCents: 1_000, reason: 'full' })
    expect(computeLine(expense({ franchise: true }), company)).toMatchObject({ recoverableVatCents: 0, reason: 'franchise' })
  })
})
