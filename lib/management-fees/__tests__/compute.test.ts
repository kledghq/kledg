/**
 * The pricing engine of management fees (lib/management-fees/compute.ts) on
 * plain values: cost plus with a mark-up (OECD Transfer Pricing Guidelines,
 * chapter VII, §7.61; BOFiP BOI-BIC-BASE-80), the allocation keys, the
 * rounding that makes the parts sum to the total in cents, the VAT of each
 * part equal to the VAT of its invoice (CGI ann. II art. 242 nonies A, I,
 * 11°), and the prorata of a subsidiary present part of the period.
 */

import { describe, expect, it } from 'vitest'
import { ValidationError } from '@/lib/accounting/errors'
import { computeInvoiceTotals } from '@/lib/invoices/amounts'
import { computeManagementFees, costPlusAmounts, eligibleDays, type ComputeInput, type ComputeSubsidiary } from '../compute'
import { DEFAULT_EXCLUDED_PREFIXES, formatRateBp, isPooledAccount, parsePercentBp, percentInput } from '../rules'

const sub = (id: string, over: Partial<ComputeSubsidiary> = {}): ComputeSubsidiary => ({
  subsidiaryId: id,
  name: `Filiale ${id}`,
  sharePercentBp: null,
  eligibleDays: 90,
  revenueCents: null,
  ...over,
})

const input = (over: Partial<ComputeInput> = {}): ComputeInput => ({
  pricing: 'COST_PLUS',
  markupBp: 500,
  costShareBp: 10000,
  fixedAmountCents: null,
  allocationKey: 'EQUAL',
  vatRateBp: 2000,
  costPoolCents: 1_000_000,
  subsidiaries: [sub('a'), sub('b')],
  ...over,
})

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

describe('cost plus (OECD TPG chapter VII; BOFiP BOI-BIC-BASE-80)', () => {
  it('adds the mark-up to the pool: 10 000,00 € at 5 % gives 10 500,00 € HT', () => {
    expect(costPlusAmounts(1_000_000, 10000, 500)).toEqual({ baseCents: 1_000_000, markupCents: 50_000, totalCents: 1_050_000 })
  })

  it('charges only the service share of the pool, then the mark-up, rounded once', () => {
    // 12 345,67 x 80 % = 9 876,536 -> base 9 876,54; x 1,075 = 10 617,2762 -> total 10 617,28
    expect(costPlusAmounts(1_234_567, 8000, 750)).toEqual({ baseCents: 987_654, markupCents: 74_074, totalCents: 1_061_728 })
  })

  it('rounds half away from zero and keeps base + mark-up = total exactly', () => {
    // 0,01 € at 50 %: base 0,005 -> 0,01 (half up); total 0,005 x 1,1 = 0,0055 -> 0,01
    const amounts = costPlusAmounts(1, 5000, 1000)
    expect(amounts).toEqual({ baseCents: 1, markupCents: 0, totalCents: 1 })
    for (const [pool, share, markup] of [[333_333, 3333, 777], [99_999_999, 10000, 1000], [7, 10000, 0]]) {
      const a = costPlusAmounts(pool, share, markup)
      expect(a.baseCents + a.markupCents).toBe(a.totalCents)
    }
  })
})

describe('allocation keys', () => {
  it('splits equally and gives the rounding remainder to one part: 100,00 € in three makes 33,34 + 33,33 + 33,33', () => {
    const result = computeManagementFees(input({ pricing: 'FIXED', fixedAmountCents: 10_000, subsidiaries: [sub('a'), sub('b'), sub('c')] }))
    expect(result.parts.map((p) => p.amountExclTaxCents)).toEqual([3_334, 3_333, 3_333])
    expect(sum(result.parts.map((p) => p.amountExclTaxCents))).toBe(10_000)
    expect(result.markupCents).toBe(0)
  })

  it('applies custom percentages', () => {
    const result = computeManagementFees(
      input({
        allocationKey: 'CUSTOM',
        costPoolCents: 1_000_000,
        subsidiaries: [sub('a', { sharePercentBp: 6000 }), sub('b', { sharePercentBp: 2500 }), sub('c', { sharePercentBp: 1500 })],
      }),
    )
    expect(result.totalExclTaxCents).toBe(1_050_000)
    expect(result.parts.map((p) => p.amountExclTaxCents)).toEqual([630_000, 262_500, 157_500])
  })

  it('splits by the revenue of each subsidiary, never by a negative one', () => {
    const result = computeManagementFees(
      input({
        allocationKey: 'REVENUE',
        pricing: 'FIXED',
        fixedAmountCents: 90_000,
        subsidiaries: [sub('a', { revenueCents: 2_000_000 }), sub('b', { revenueCents: 1_000_000 }), sub('c', { revenueCents: -50_000 })],
      }),
    )
    expect(result.parts.map((p) => p.amountExclTaxCents)).toEqual([60_000, 30_000, 0])
  })

  it('prorates a subsidiary that joins during the period, and spreads the whole amount over those present', () => {
    // 90 days for a, 30 days for b (joined two thirds into the quarter), c left before the period
    const result = computeManagementFees(
      input({ pricing: 'FIXED', fixedAmountCents: 120_000, subsidiaries: [sub('a'), sub('b', { eligibleDays: 30 }), sub('c', { eligibleDays: 0 })] }),
    )
    expect(result.parts.map((p) => p.amountExclTaxCents)).toEqual([90_000, 30_000, 0])
    expect(result.parts.map((p) => p.vatCents)).toEqual([18_000, 6_000, 0])
  })

  it('keeps the parts summing to the total in cents for any amount and weights', () => {
    let seed = 42
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648)
    for (let round = 0; round < 500; round += 1) {
      const count = 1 + (next() % 7)
      const subsidiaries = Array.from({ length: count }, (_, i) => sub(String(i), { revenueCents: next() % 10_000_000, eligibleDays: 1 + (next() % 366) }))
      if (subsidiaries.every((s) => !s.revenueCents)) continue
      const result = computeManagementFees(input({ allocationKey: round % 2 ? 'REVENUE' : 'EQUAL', costPoolCents: 1 + (next() % 50_000_000), markupBp: next() % 2000, subsidiaries }))
      expect(sum(result.parts.map((p) => p.amountExclTaxCents))).toBe(result.totalExclTaxCents)
      expect(sum(result.parts.map((p) => p.vatCents))).toBe(result.totalVatCents)
      expect(result.totalInclTaxCents).toBe(result.totalExclTaxCents + result.totalVatCents)
    }
  })
})

describe('VAT of each part', () => {
  it('is the VAT of the invoice Kledg records for that amount (one line, rate x base, rounded once)', () => {
    const result = computeManagementFees(input({ costPoolCents: 1_234_567, markupBp: 700, subsidiaries: [sub('a'), sub('b'), sub('c')] }))
    for (const part of result.parts) {
      const invoice = computeInvoiceTotals([{ quantityThousandths: 1000, unitPriceCents: part.amountExclTaxCents, vatRateBp: 2000 }])
      expect(part.vatCents).toBe(invoice.totalVatCents)
      expect(part.amountInclTaxCents).toBe(invoice.totalInclTaxCents)
    }
  })

  it('follows the rate of the convention, 0 % included', () => {
    const reduced = computeManagementFees(input({ pricing: 'FIXED', fixedAmountCents: 10_001, vatRateBp: 1000, subsidiaries: [sub('a')] }))
    expect(reduced.parts[0]).toMatchObject({ amountExclTaxCents: 10_001, vatCents: 1_000, amountInclTaxCents: 11_001 })
    const exempt = computeManagementFees(input({ pricing: 'FIXED', fixedAmountCents: 10_001, vatRateBp: 0, subsidiaries: [sub('a')] }))
    expect(exempt.parts[0]).toMatchObject({ vatCents: 0, amountInclTaxCents: 10_001 })
  })
})

describe('nothing to invoice', () => {
  it('refuses a null or negative cost pool with a French message', () => {
    expect(() => computeManagementFees(input({ costPoolCents: 0 }))).toThrow(ValidationError)
    expect(() => computeManagementFees(input({ costPoolCents: -10 }))).toThrow(/nulles ou négatives/)
  })

  it('refuses the revenue key when no subsidiary has revenue', () => {
    expect(() => computeManagementFees(input({ allocationKey: 'REVENUE', subsidiaries: [sub('a', { revenueCents: 0 })] }))).toThrow(/Aucune filiale n’a de chiffre d’affaires/)
  })

  it('refuses a period where no subsidiary is party to the convention', () => {
    expect(() => computeManagementFees(input({ subsidiaries: [sub('a', { eligibleDays: 0 })] }))).toThrow(/Aucune filiale n’est partie/)
  })

  it('refuses a fixed amount missing and a convention without subsidiary', () => {
    expect(() => computeManagementFees(input({ pricing: 'FIXED', fixedAmountCents: null }))).toThrow(/montant forfaitaire/)
    expect(() => computeManagementFees(input({ subsidiaries: [] }))).toThrow(/aucune filiale/)
  })
})

describe('eligible days', () => {
  it('counts the days of the period the subsidiary is party to the convention, bounds included', () => {
    expect(eligibleDays('2026-01-01', '2026-03-31', null, null)).toEqual({ days: 90, start: '2026-01-01', end: '2026-03-31' })
    expect(eligibleDays('2026-01-01', '2026-03-31', '2026-03-02', null)).toEqual({ days: 30, start: '2026-03-02', end: '2026-03-31' })
    expect(eligibleDays('2026-01-01', '2026-03-31', null, '2026-01-10').days).toBe(10)
    expect(eligibleDays('2026-01-01', '2026-03-31', '2026-04-01', null).days).toBe(0)
    // Leap year, across the end of February
    expect(eligibleDays('2028-02-01', '2028-03-01', null, null).days).toBe(30)
  })
})

describe('rules', () => {
  it('pools class 6 without income tax, penalties, financial and exceptional charges by default', () => {
    const excluded = DEFAULT_EXCLUDED_PREFIXES.map((e) => e.prefix)
    expect(isPooledAccount('6226', ['6'], excluded)).toBe(true)
    expect(isPooledAccount('6411', ['6'], excluded)).toBe(true)
    expect(isPooledAccount('6811', ['6'], excluded)).toBe(true)
    for (const code of ['695', '6951', '6582', '661', '6616', '678', '686', '6871', '657']) expect(isPooledAccount(code, ['6'], excluded)).toBe(false)
    expect(isPooledAccount('706', ['6'], excluded)).toBe(false)
  })

  it('reads and writes percentages in basis points', () => {
    expect(parsePercentBp('5')).toBe(500)
    expect(parsePercentBp('7,5')).toBe(750)
    expect(parsePercentBp('33.34 %')).toBe(3334)
    expect(parsePercentBp('100')).toBe(10000)
    expect(parsePercentBp('100,01')).toBeNull()
    expect(parsePercentBp('5,555')).toBeNull()
    expect(parsePercentBp('abc')).toBeNull()
    expect(formatRateBp(750)).toBe('7,5 %')
    expect(percentInput(3334)).toBe('33,34')
  })
})
