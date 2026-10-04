/**
 * Aggregation and intragroup eliminations of the group view (combine.ts),
 * on the worked example of docs/vue-groupe.md: a holding H and two
 * subsidiaries A and B, figures in euros (x 100 for cents).
 *
 * Source of the rules: an indicative combined view, not consolidation
 * (règlement ANC 2020-01 for consolidated accounts; Code de commerce,
 * art. L233-16 and L233-17 for when they are required). The SIG buckets
 * that make up the EBE are those of the PCG income statement
 * (lib/reports/financial-indicators/sig.ts).
 */

import { describe, expect, it } from 'vitest'
import { applyEliminations, computeEliminations, sumFigures, type IntragroupObservation, type KeyFigures } from '../combine'

const e = (euros: number) => euros * 100

function figures(ca: number, ebe: number, resultat: number, tresorerie: number, cp: number, dettes: number, total: number): KeyFigures {
  return {
    chiffreAffairesCents: e(ca),
    ebeCents: e(ebe),
    resultatCents: e(resultat),
    tresorerieCents: e(tresorerie),
    capitauxPropresCents: e(cp),
    endettementCents: e(dettes),
    totalBilanCents: e(total),
  }
}

const H = figures(50_000, 10_000, 25_000, 5_000, 300_000, 0, 320_000)
const A = figures(400_000, 60_000, 40_000, 80_000, 150_000, 50_000, 260_000)
const B = figures(200_000, 20_000, 8_000, 15_000, 60_000, 0, 90_000)

const obs = (companyId: string, counterpartyId: string, category: IntragroupObservation['category'], accountCode: string, euros: number, inBooks = true): IntragroupObservation => ({
  companyId,
  counterpartyId,
  category,
  accountCode,
  cents: e(euros),
  source: 'invoice',
  reference: `${accountCode}`,
  inBooks,
})

const FLOWS: IntragroupObservation[] = [
  // Management fees: H invoices A 30 000 and B 20 000 (706); A books 30 000, B only 18 000 (6226).
  obs('h', 'a', 'management_fee', '706000', 30_000),
  obs('h', 'b', 'management_fee', '706000', 20_000),
  obs('a', 'h', 'management_fee', '6226', 30_000),
  obs('b', 'h', 'management_fee', '6226', 18_000),
  // A sells goods to B: 707 at A, 607 at B.
  obs('a', 'b', 'invoice', '707000', 10_000),
  obs('b', 'a', 'invoice', '607', 10_000),
  // Dividends received by H from A (761).
  obs('h', 'a', 'dividend', '761', 15_000),
  // Current account: H lends 25 000 to A (451 debit at H, 455 credit at A).
  obs('h', 'a', 'current_account', '451000', 25_000),
  obs('a', 'h', 'current_account', '455100', -25_000),
  // B owes A 12 000 TTC (411 debit at A, 401 credit at B).
  obs('a', 'b', 'trade', '411000', 12_000),
  obs('b', 'a', 'trade', '401000', -12_000),
]

describe('combined view of the worked example', () => {
  const combined = sumFigures([H, A, B])
  const eliminations = computeEliminations(FLOWS, new Set(['h', 'a', 'b']))
  const after = applyEliminations(combined, eliminations.effect)

  it('adds the companies at 100 %, the ownership is never applied', () => {
    expect(combined).toEqual(figures(650_000, 90_000, 73_000, 100_000, 510_000, 50_000, 670_000))
  })

  it('removes intragroup revenue from the chiffre d’affaires and both sides from the EBE', () => {
    // Produits 706 50 000 + 707 10 000 leave the CA; charges 6226 48 000 + 607 10 000 leave the EBE too.
    expect(eliminations.effect.chiffreAffairesCents).toBe(-e(60_000))
    expect(eliminations.effect.ebeCents).toBe(-e(2_000))
  })

  it('removes dividends from a subsidiary from the result, and the écart of an unbalanced flow stays in it', () => {
    // -60 000 + 58 000 (operations, écart of 2 000 on B's fees) - 15 000 (dividends).
    expect(eliminations.effect.resultatCents).toBe(-e(17_000))
    expect(eliminations.dividends).toEqual([{ receiverId: 'h', payerId: 'a', cents: e(15_000) }])
  })

  it('reports each pair of operations with its écart', () => {
    expect(eliminations.operations).toEqual([
      { sellerId: 'a', buyerId: 'b', categories: ['invoice'], revenueCents: e(10_000), chargeCents: e(10_000), gapCents: 0 },
      { sellerId: 'h', buyerId: 'a', categories: ['management_fee'], revenueCents: e(30_000), chargeCents: e(30_000), gapCents: 0 },
      { sellerId: 'h', buyerId: 'b', categories: ['management_fee'], revenueCents: e(20_000), chargeCents: e(18_000), gapCents: e(2_000) },
    ])
  })

  it('removes reciprocal receivables and payables from both sides of the balance sheet', () => {
    expect(eliminations.balances).toEqual([
      { creditorId: 'a', debtorId: 'b', categories: ['trade'], receivableCents: e(12_000), payableCents: e(12_000), eliminatedCents: e(12_000), gapCents: 0 },
      { creditorId: 'h', debtorId: 'a', categories: ['current_account'], receivableCents: e(25_000), payableCents: e(25_000), eliminatedCents: e(25_000), gapCents: 0 },
    ])
    expect(eliminations.effect.totalBilanCents).toBe(-e(37_000))
  })

  it('gives the figures after eliminations; treasury, equity and debt unchanged', () => {
    expect(after).toEqual(figures(590_000, 88_000, 56_000, 100_000, 510_000, 50_000, 633_000))
  })
})

describe('computeEliminations', () => {
  it('leaves out a flow with a company outside the combined perimeter (an unreadable subsidiary)', () => {
    const result = computeEliminations(FLOWS, new Set(['h', 'a']))
    // Only H <-> A remains: 706 30 000 vs 6226 30 000, dividends 15 000, current account 25 000.
    expect(result.effect.chiffreAffairesCents).toBe(-e(30_000))
    expect(result.effect.ebeCents).toBe(0)
    expect(result.effect.resultatCents).toBe(-e(15_000))
    expect(result.effect.totalBilanCents).toBe(-e(25_000))
    expect(result.operations.map((p) => p.buyerId)).toEqual(['a'])
  })

  it('never eliminates what is not in the validated books (a draft management fee invoice)', () => {
    const result = computeEliminations([obs('h', 'a', 'management_fee', '706000', 9_000, false), obs('a', 'h', 'management_fee', '6226', 9_000, false)], new Set(['h', 'a']))
    expect(result.effect).toEqual(figures(0, 0, 0, 0, 0, 0, 0))
    expect(result.operations).toEqual([])
  })

  it('eliminates the smaller side of a reciprocal balance and reports the écart', () => {
    const result = computeEliminations([obs('h', 'a', 'current_account', '451', 30_000), obs('a', 'h', 'current_account', '455', -28_500)], new Set(['h', 'a']))
    expect(result.balances[0]).toMatchObject({ receivableCents: e(30_000), payableCents: e(28_500), eliminatedCents: e(28_500), gapCents: e(1_500) })
    expect(result.effect.totalBilanCents).toBe(-e(28_500))
  })

  it('reduces the financial debt when the payable is a loan (168)', () => {
    const result = computeEliminations([obs('h', 'a', 'loan', '2674', 100_000), obs('a', 'h', 'loan', '1687', -100_000)], new Set(['h', 'a']))
    expect(result.effect.endettementCents).toBe(-e(100_000))
    expect(result.effect.totalBilanCents).toBe(-e(100_000))
  })

  it('keeps a product outside the EBE (financial interest) out of the EBE but in the result', () => {
    const result = computeEliminations([obs('h', 'a', 'current_account', '7681', 1_000), obs('a', 'h', 'current_account', '6615', 1_000)], new Set(['h', 'a']))
    expect(result.effect).toMatchObject({ chiffreAffairesCents: 0, ebeCents: 0, resultatCents: 0 })
    expect(result.operations[0]).toMatchObject({ revenueCents: e(1_000), chargeCents: e(1_000), gapCents: 0 })
  })

  it('ignores a company recorded on itself', () => {
    expect(computeEliminations([obs('h', 'h', 'invoice', '706', 1_000)], new Set(['h'])).operations).toEqual([])
  })
})
