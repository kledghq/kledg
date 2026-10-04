/**
 * Budget calculations on plain values: months of a fiscal year, recurring
 * items, prefixes of a line (PCG art. 932-1, longest prefix wins), the even
 * spread of an annual amount and the comparison with the books (charges
 * debit minus credit, produits credit minus debit, PCG art. 821-1).
 */

import { describe, expect, it } from 'vitest'
import { fiscalYearMonths, isMonthKey, monthIndex, monthKeyOfDay, monthsBetween } from '../months'
import { expandRecurringItem, fallsDueIn, plannedByMonth, spreadEvenly, type RecurringItem } from '../recurring'
import { matchPrefix, sideOfAccount } from '../prefixes'
import { buildBudgetComparison, compare } from '../report'

const YEAR_2026 = fiscalYearMonths('2026-01-01', '2026-12-31')

describe('months', () => {
  it('lists the calendar months a fiscal year touches, partial ones included', () => {
    expect(YEAR_2026).toHaveLength(12)
    expect(YEAR_2026[0]).toBe('2026-01')
    expect(YEAR_2026[11]).toBe('2026-12')
    // A first fiscal year from mid-March 2026 to the end of 2027 (a first fiscal year may run longer than twelve months)
    const long = fiscalYearMonths('2026-03-15', '2027-12-31')
    expect(long).toHaveLength(22)
    expect(long.slice(0, 2)).toEqual(['2026-03', '2026-04'])
    expect(long.slice(9, 12)).toEqual(['2026-12', '2027-01', '2027-02'])
  })

  it('reads the month of a day or an ISO timestamp without any timezone', () => {
    expect(monthKeyOfDay('2026-12-31')).toBe('2026-12')
    expect(monthKeyOfDay('2026-12-31T00:00:00.000Z')).toBe('2026-12')
    expect(() => monthKeyOfDay('31/12/2026')).toThrow(RangeError)
  })

  it('validates and orders months', () => {
    expect(isMonthKey('2026-01')).toBe(true)
    expect(isMonthKey('2026-13')).toBe(false)
    expect(isMonthKey('2026-1')).toBe(false)
    expect(monthIndex('2027-01') - monthIndex('2026-12')).toBe(1)
    expect(monthsBetween('2026-12', '2026-11')).toEqual([])
  })
})

describe('recurring items', () => {
  const item = (over: Partial<RecurringItem>): RecurringItem => ({ amountCents: 10_000, frequency: 'MONTHLY', startMonth: '2026-01', endMonth: null, ...over })

  it('falls due every month from its first month', () => {
    expect(expandRecurringItem(item({ startMonth: '2026-04' }), YEAR_2026)).toEqual([0, 0, 0, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000])
  })

  it('keeps the rhythm of a quarterly item anchored in the previous year', () => {
    const due = expandRecurringItem(item({ frequency: 'QUARTERLY', startMonth: '2025-11' }), YEAR_2026)
    expect(YEAR_2026.filter((_, i) => due[i] !== 0)).toEqual(['2026-02', '2026-05', '2026-08', '2026-11'])
  })

  it('falls due once a year for a yearly item, and never after its last month', () => {
    expect(expandRecurringItem(item({ frequency: 'YEARLY', startMonth: '2024-06' }), YEAR_2026).filter((c) => c !== 0)).toEqual([10_000])
    expect(fallsDueIn(item({ frequency: 'YEARLY', startMonth: '2026-06' }), '2026-06')).toBe(true)
    const ending = expandRecurringItem(item({ endMonth: '2026-03' }), YEAR_2026)
    expect(ending.filter((c) => c !== 0)).toHaveLength(3)
    expect(fallsDueIn(item({ endMonth: '2026-03' }), '2026-04')).toBe(false)
  })

  it('adds recurring items to the amounts entered by month, ignoring months outside the year', () => {
    const planned = plannedByMonth(
      YEAR_2026,
      [
        { month: '2026-01', amountCents: 50_000 },
        { month: '2025-12', amountCents: 99_999 },
      ],
      [item({ amountCents: 1_500 }), item({ frequency: 'QUARTERLY', amountCents: 30_000 })],
    )
    expect(planned[0]).toBe(50_000 + 1_500 + 30_000)
    expect(planned[1]).toBe(1_500)
    expect(planned[3]).toBe(1_500 + 30_000)
    expect(planned.reduce((a, b) => a + b, 0)).toBe(50_000 + 12 * 1_500 + 4 * 30_000)
  })
})

describe('spreadEvenly', () => {
  it('gives the rounding remainder to the last month so the parts add up to the total', () => {
    const parts = spreadEvenly(100_000, 12)
    expect(parts.slice(0, 11).every((p) => p === 8_333)).toBe(true)
    expect(parts[11]).toBe(8_337)
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100_000)
    expect(spreadEvenly(-1_000, 3)).toEqual([-333, -333, -334])
  })

  it('refuses euros and an empty period', () => {
    expect(() => spreadEvenly(10.5, 12)).toThrow(RangeError)
    expect(() => spreadEvenly(1_000, 0)).toThrow(RangeError)
  })
})

describe('prefixes', () => {
  it('reads charges in class 6 and produits in class 7 only', () => {
    expect(sideOfAccount('6064')).toBe('charges')
    expect(sideOfAccount('706000')).toBe('produits')
    expect(sideOfAccount('512000')).toBeNull()
  })

  it('gives an account to the longest prefix it starts with', () => {
    expect(matchPrefix('622600', ['6', '62', '6226'])).toBe('6226')
    expect(matchPrefix('622800', ['6', '62', '6226'])).toBe('62')
    expect(matchPrefix('606400', ['62', '6226'])).toBeNull()
  })
})

describe('compare', () => {
  it('reads an overspent charge as unfavorable and an exceeded produit as favorable', () => {
    expect(compare('charges', 100_000, 112_500)).toEqual({ budgetCents: 100_000, actualCents: 112_500, varianceCents: 12_500, variancePercent: 12.5, favorable: false })
    expect(compare('produits', 100_000, 112_500).favorable).toBe(true)
    expect(compare('charges', 100_000, 90_000)).toMatchObject({ varianceCents: -10_000, variancePercent: -10, favorable: true })
  })

  it('gives no percentage without a budget, and reads a negative budget by its size', () => {
    expect(compare('charges', 0, 5_000).variancePercent).toBeNull()
    expect(compare('resultat', -10_000, -5_000)).toMatchObject({ varianceCents: 5_000, variancePercent: 50, favorable: true })
    expect(compare('charges', 30_000, 10_000).variancePercent).toBe(-66.7)
  })
})

describe('buildBudgetComparison', () => {
  const months = ['2026-01', '2026-02', '2026-03']
  const lines = [
    { id: 'l-62', accountPrefix: '62', label: 'Autres services extérieurs', months: [10_000, 10_000, 10_000] },
    { id: 'l-6226', accountPrefix: '6226', label: 'Honoraires', months: [50_000, 0, 0] },
    { id: 'l-706', accountPrefix: '706', label: 'Prestations de services', months: [200_000, 200_000, 200_000] },
  ]
  const accounts = [
    // Charges: debit minus credit, a credit note in March
    { code: '622600', label: 'Honoraires', debitBalances: [60_000, 0, 0] },
    { code: '626000', label: 'Frais postaux et de télécommunications', debitBalances: [4_000, 4_000, -1_000] },
    { code: '625100', label: 'Voyages et déplacements', debitBalances: [0, 7_000, 0] },
    { code: '606400', label: 'Fournitures administratives', debitBalances: [2_500, 0, 0] },
    // Produits are credits: negative debit balances
    { code: '706000', label: 'Prestations de services', debitBalances: [-180_000, -230_000, -150_000] },
    { code: '758000', label: 'Produits divers de gestion courante', debitBalances: [0, 0, -300] },
    // Not a budget account, and an account without movement
    { code: '512000', label: 'Banque', debitBalances: [99_999, 0, 0] },
    { code: '613200', label: 'Locations immobilières', debitBalances: [0, 0, 0] },
  ]
  const report = buildBudgetComparison({ months, lines, accounts })

  it('counts each account once, on the line of its longest prefix', () => {
    const [l62, l6226] = report.charges.lines
    expect(l6226.accounts.map((a) => a.code)).toEqual(['622600'])
    expect(l6226).toMatchObject({ budgetCents: 50_000, actualCents: 60_000, varianceCents: 10_000, variancePercent: 20, favorable: false })
    expect(l62.accounts.map((a) => a.code)).toEqual(['625100', '626000'])
    expect(l62).toMatchObject({ budgetCents: 30_000, actualCents: 14_000, varianceCents: -16_000, favorable: true })
    expect(l62.months.map((m) => m.actualCents)).toEqual([4_000, 11_000, -1_000])
  })

  it('reads produits as credit minus debit', () => {
    const [l706] = report.produits.lines
    expect(l706).toMatchObject({ budgetCents: 600_000, actualCents: 560_000, varianceCents: -40_000, variancePercent: -6.7, favorable: false })
  })

  it('lists the accounts no line matches as hors budget, so totals are those of the compte de résultat', () => {
    expect(report.charges.unbudgeted.map((r) => [r.accountPrefix, r.actualCents, r.budgetCents, r.lineId])).toEqual([['606400', 2_500, 0, null]])
    expect(report.produits.unbudgeted.map((r) => [r.accountPrefix, r.actualCents])).toEqual([['758000', 300]])
    // Charges: 60 000 + 7 000 + 7 000 + 2 500; produits: 560 000 + 300
    expect(report.charges.total).toMatchObject({ budgetCents: 80_000, actualCents: 76_500, annualBudgetCents: 80_000 })
    expect(report.produits.total).toMatchObject({ budgetCents: 600_000, actualCents: 560_300 })
    expect(report.resultat).toMatchObject({ budgetCents: 520_000, actualCents: 483_800, varianceCents: -36_200, favorable: false })
    expect(report.resultat.months.map((m) => m.actualCents)).toEqual([180_000 - 66_500, 230_000 - 11_000, 150_300 - (-1_000)])
  })

  it('compares the months up to a given month, keeping the annual budget', () => {
    const toFebruary = buildBudgetComparison({ months, lines, accounts, throughMonth: '2026-02' })
    expect(toFebruary.throughMonth).toBe('2026-02')
    expect(toFebruary.produits.lines[0]).toMatchObject({ budgetCents: 400_000, actualCents: 410_000, annualBudgetCents: 600_000, favorable: true })
    expect(toFebruary.charges.total).toMatchObject({ budgetCents: 70_000, actualCents: 77_500, annualBudgetCents: 80_000 })
    expect(toFebruary.charges.total.months).toHaveLength(3)
    expect(() => buildBudgetComparison({ months, lines, accounts, throughMonth: '2026-04' })).toThrow(RangeError)
  })

  it('never answers -0 for a produit month without movement', () => {
    const quiet = buildBudgetComparison({ months, lines: [lines[2]], accounts: [{ code: '706000', label: 'Prestations de services', debitBalances: [0, -100, 0] }] })
    expect(Object.is(quiet.produits.lines[0].months[0].actualCents, 0)).toBe(true)
    expect(quiet.produits.lines[0].months[1].actualCents).toBe(100)
  })

  it('handles a budget without lines and books without entries', () => {
    const empty = buildBudgetComparison({ months, lines: [], accounts: [] })
    expect(empty.resultat).toMatchObject({ budgetCents: 0, actualCents: 0, varianceCents: 0, variancePercent: null })
    expect(empty.charges.lines).toEqual([])
  })
})
