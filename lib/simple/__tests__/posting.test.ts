/**
 * VAT lines of simple mode (lib/simple/posting.ts), in cents:
 * - VAT included in the amount: TTC x rate / (1 + rate), half up, or the VAT
 *   the bank read when plausible (at most 20 % of the base, CGI art. 278);
 * - recovery per category rule: full, nothing on passenger transport (CGI
 *   ann. II art. 206, IV, 2, 5°), staff lodging (2°) and passenger vehicles
 *   (6°), 80 % on passenger car fuel (CGI art. 298, 4, 1°, a), gifts up to
 *   73 € TTC (3°; ann. IV art. 28-00 A); prorata of an exempt company
 *   (its provisional coefficient de déduction, lib/vat-deduction/coefficient.ts);
 * - 44562 on fixed assets, 44566 otherwise, 44571 collected (PCG art. 944-44);
 * - counterpart lines always sum to the bank amount, on the opposite side.
 */

import { describe, expect, it } from 'vitest'
import { ALL_CATEGORIES, findCategory } from '../categories'
import { buildPostingLines, exclTaxCents, plausibleBankVat, resolvePosting, type Side } from '../posting'

function plan(
  id: string,
  amountCents: number,
  options: { side?: Side; answers?: Record<string, string>; bankVatCents?: number | null; recoveryRatio?: number | null; franchise?: boolean } = {},
) {
  const category = findCategory(id)!
  const resolution = resolvePosting(category, options.answers ?? {}, amountCents, options.bankVatCents)
  if (resolution.status !== 'ready') throw new Error(`${id}: ${resolution.status}`)
  return buildPostingLines({
    category,
    posting: resolution.posting,
    kind: resolution.kind,
    side: options.side ?? 'debit',
    amountCents,
    bankVatCents: options.bankVatCents,
    recoveryRatio: options.recoveryRatio ?? null,
    franchise: options.franchise,
  })
}

const lines = (p: ReturnType<typeof plan>) => p.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents])

describe('expense VAT lines', () => {
  it('splits a phone bill of 47,99 € into 39,99 € of charge and 8,00 € of deductible VAT', () => {
    const p = plan('telephone-internet', 4_799)
    expect(lines(p)).toEqual([
      ['626', 3_999, 0],
      ['44566', 800, 0],
    ])
    expect(p.vatNote).toBe('TVA récupérable')
  })

  it('keeps the VAT of a train ticket in the charge (passenger transport)', () => {
    const p = plan('deplacements', 12_800)
    expect(lines(p)).toEqual([['6251', 12_800, 0]])
    expect(p.vatCents).toBe(1_164)
    expect(p.vatNote).toMatch(/Transport de personnes/)
  })

  it('keeps the VAT of a hotel in the charge (staff lodging)', () => {
    expect(lines(plan('hotel', 11_000))).toEqual([['6256', 11_000, 0]])
  })

  it('recovers 80 % of the VAT on fuel for a passenger car, all of it for a utility vehicle', () => {
    // 60,00 € TTC at 20 %: 10,00 € of VAT, 8,00 € recovered
    expect(lines(plan('carburant', 6_000, { answers: { vehicle: 'passenger-car' } }))).toEqual([
      ['6061', 5_200, 0],
      ['44566', 800, 0],
    ])
    expect(lines(plan('carburant', 6_000, { answers: { vehicle: 'utility' } }))).toEqual([
      ['6061', 5_000, 0],
      ['44566', 1_000, 0],
    ])
  })

  it('recovers nothing on renting or repairing a passenger car', () => {
    const p = plan('location-vehicule', 36_000, { answers: { vehicle: 'passenger-car' } })
    expect(lines(p)).toEqual([['6135', 36_000, 0]])
    expect(p.vatNote).toMatch(/206, IV, 2, 6°/)
    expect(lines(plan('entretien-vehicule', 24_000, { answers: { vehicle: 'utility' } }))).toEqual([
      ['6155', 20_000, 0],
      ['44566', 4_000, 0],
    ])
  })

  it('recovers the VAT of a gift up to 73 € TTC only', () => {
    expect(lines(plan('cadeaux-clients', 6_000))).toEqual([
      ['6234', 5_000, 0],
      ['44566', 1_000, 0],
    ])
    expect(lines(plan('cadeaux-clients', 8_000))).toEqual([['6234', 8_000, 0]])
  })

  it('books a durable computer of 1 499 € to 2183 with its VAT on 44562', () => {
    expect(lines(plan('materiel-informatique', 149_900, { answers: { durable: 'durable' } }))).toEqual([
      ['2183', 124_917, 0],
      ['44562', 24_983, 0],
    ])
    expect(lines(plan('materiel-informatique', 149_900, { answers: { durable: 'consumable' } }))).toEqual([
      ['6063', 124_917, 0],
      ['44566', 24_983, 0],
    ])
  })

  it('books a meal with clients to 6257 at 10 %', () => {
    expect(lines(plan('repas-affaires', 6_450))).toEqual([
      ['6257', 5_864, 0],
      ['44566', 586, 0],
    ])
  })

  it('books an insurance premium, bank fees and postage in full (exempt operations)', () => {
    expect(lines(plan('assurances', 45_000))).toEqual([['616', 45_000, 0]])
    expect(lines(plan('frais-bancaires', 1_200))).toEqual([['627', 1_200, 0]])
    expect(lines(plan('courrier', 1_290))).toEqual([['626', 1_290, 0]])
  })

  it('books movements that are not taxed operations in one line', () => {
    expect(lines(plan('tva-payee', 218_600))).toEqual([['4455', 218_600, 0]])
    expect(lines(plan('salaires', 210_000))).toEqual([['421', 210_000, 0]])
  })

  it('uses the VAT the bank read when it is plausible', () => {
    expect(lines(plan('fournitures', 12_000, { bankVatCents: 1_091 }))).toEqual([
      ['6064', 10_909, 0],
      ['44566', 1_091, 0],
    ])
    // More than 20 % of the base: ignored, the category rate applies
    expect(lines(plan('fournitures', 12_000, { bankVatCents: 5_000 }))).toEqual([
      ['6064', 10_000, 0],
      ['44566', 2_000, 0],
    ])
    expect(plausibleBankVat(12_000, 2_000)).toBe(2_000)
    expect(plausibleBankVat(12_000, 0)).toBeNull()
    expect(plausibleBankVat(12_000, null)).toBeNull()
    expect(exclTaxCents(60_000, 2000)).toBe(50_000)
  })

  it('applies the coefficient de déduction of a partly exempt company, nothing for a franchise', () => {
    const partial = plan('telephone-internet', 12_000, { recoveryRatio: 0.5 })
    expect(lines(partial)).toEqual([
      ['626', 11_000, 0],
      ['44566', 1_000, 0],
    ])
    expect(partial.vatNote).toBe('Coefficient de déduction provisoire\u00a0: 50 % de la TVA récupérable (CGI ann. II art. 206)')
    const franchise = plan('telephone-internet', 12_000, { recoveryRatio: 0 })
    expect(lines(franchise)).toEqual([['626', 12_000, 0]])
    expect(franchise.vatNote).toMatch(/0 % de la TVA récupérable/)
  })

  it('books a refund (money in) on the other side', () => {
    expect(lines(plan('fournitures', 2_400, { side: 'credit' }))).toEqual([
      ['6064', 0, 2_000],
      ['44566', 0, 400],
    ])
  })
})

describe('income VAT lines', () => {
  it('splits a sale of 1 200 € into 1 000 € of services and 200 € of collected VAT', () => {
    expect(lines(plan('ventes-prestations', 120_000, { side: 'credit' }))).toEqual([
      ['706', 0, 100_000],
      ['44571', 0, 20_000],
    ])
  })

  it('collects no VAT for a company under the franchise (CGI art. 293 B)', () => {
    const franchise = plan('ventes-prestations', 120_000, { side: 'credit', recoveryRatio: 0, franchise: true })
    expect(lines(franchise)).toEqual([['706', 0, 120_000]])
    expect(franchise.vatNote).toMatch(/Franchise en base/)
  })

  // R3 QUAL-01: the coefficient de déduction limits what a partly exempt
  // company deducts, never what it collects on a taxed sale (CGI art. 256).
  it('collects the VAT of a taxed sale of a partly exempt company: 1 200 € TTC at 20 %, coefficient 60 %', () => {
    const partial = plan('ventes-prestations', 120_000, { side: 'credit', answers: { 'sale-vat-rate': 'standard' }, recoveryRatio: 0.6 })
    expect(lines(partial)).toEqual([
      ['706', 0, 100_000],
      ['44571', 0, 20_000],
    ])
    expect(partial.vatNote).toBe('TVA collectée')
    // Its exempt sales (training, CGI art. 261, 4, 4° a) are the answer "Sans TVA"
    expect(lines(plan('ventes-prestations', 120_000, { side: 'credit', answers: { 'sale-vat-rate': 'none' }, recoveryRatio: 0.6 }))).toEqual([['706', 0, 120_000]])
  })

  it('books a grant and interest without VAT', () => {
    expect(lines(plan('subvention', 500_000, { side: 'credit' }))).toEqual([['741', 0, 500_000]])
    expect(lines(plan('interets-recus', 1_234, { side: 'credit' }))).toEqual([['768', 0, 1_234]])
  })

  it('collects the VAT at the rate of the invoice (CGI art. 278, 279, 278-0 bis, 281 quater), none abroad', () => {
    // 1 100 € TTC at 10 %: 1 000 € + 100 €
    expect(lines(plan('ventes-prestations', 110_000, { side: 'credit', answers: { 'sale-vat-rate': 'intermediate' } }))).toEqual([
      ['706', 0, 100_000],
      ['44571', 0, 10_000],
    ])
    // 105,50 € TTC at 5,5 %: 100 € + 5,50 €
    expect(lines(plan('ventes-marchandises', 10_550, { side: 'credit', answers: { 'sale-vat-rate': 'reduced' } }))).toEqual([
      ['707', 0, 10_000],
      ['44571', 0, 550],
    ])
    // 102,10 € TTC at 2,1 %: 100 € + 2,10 €
    expect(lines(plan('ventes-produits', 10_210, { side: 'credit', answers: { 'sale-vat-rate': 'super-reduced' } }))).toEqual([
      ['701', 0, 10_000],
      ['44571', 0, 210],
    ])
    expect(lines(plan('ventes-prestations', 250_000, { side: 'credit', answers: { 'sale-vat-rate': 'none' } }))).toEqual([['706', 0, 250_000]])
  })

  it('books money from a partner by the answer: current account, capital, or a sale with its VAT', () => {
    expect(lines(plan('versement-associe', 500_000, { side: 'credit', answers: { 'owner-money': 'loan' } }))).toEqual([['455', 0, 500_000]])
    expect(lines(plan('versement-associe', 500_000, { side: 'credit', answers: { 'owner-money': 'capital' } }))).toEqual([['1013', 0, 500_000]])
    expect(lines(plan('versement-associe', 120_000, { side: 'credit', answers: { 'owner-money': 'sale' } }))).toEqual([
      ['706', 0, 100_000],
      ['44571', 0, 20_000],
    ])
  })

  it('books movements of money in on one line: loan received, VAT refund, deposit returned, cash deposited', () => {
    expect(lines(plan('emprunt-recu', 3_000_000, { side: 'credit' }))).toEqual([['164', 0, 3_000_000]])
    expect(lines(plan('remboursement-tva', 184_300, { side: 'credit' }))).toEqual([['44567', 0, 184_300]])
    expect(lines(plan('depot-garantie-rendu', 240_000, { side: 'credit' }))).toEqual([['275', 0, 240_000]])
    expect(lines(plan('depot-especes', 35_000, { side: 'credit' }))).toEqual([['53', 0, 35_000]])
  })
})

describe('refund VAT lines (règlement ANC n° 2022-06: the refund reduces the charge)', () => {
  it('reverses the charge and the deductible VAT of a refunded phone bill', () => {
    expect(lines(plan('remboursement:telephone-internet', 4_799, { side: 'credit' }))).toEqual([
      ['626', 0, 3_999],
      ['44566', 0, 800],
    ])
  })

  it('reverses only what was recovered: nothing on a train ticket, 80 % on passenger car fuel', () => {
    expect(lines(plan('remboursement:deplacements', 12_800, { side: 'credit' }))).toEqual([['6251', 0, 12_800]])
    expect(lines(plan('remboursement:carburant', 6_000, { side: 'credit', answers: { vehicle: 'passenger-car' } }))).toEqual([
      ['6061', 0, 5_200],
      ['44566', 0, 800],
    ])
  })

  it('reverses a charge without VAT on one line', () => {
    expect(lines(plan('remboursement:assurances', 32_000, { side: 'credit' }))).toEqual([['616', 0, 32_000]])
  })
})

describe('every category', () => {
  const answersFor = (id: string) => {
    const question = findCategory(id)!.question
    return question ? { [question.id]: question.answers[0].id } : {}
  }

  it.each(ALL_CATEGORIES.map((c) => c.id))('%s: counterpart lines sum to the amount, one side only, both sides', (id) => {
    for (const side of ['debit', 'credit'] as const) {
      for (const amount of [1, 999, 4_799, 149_900, 1_234_567]) {
        const p = plan(id, amount, { side, answers: answersFor(id) })
        const debit = p.lines.reduce((s, l) => s + l.debitCents, 0)
        const credit = p.lines.reduce((s, l) => s + l.creditCents, 0)
        expect(side === 'debit' ? [debit, credit] : [credit, debit]).toEqual([amount, 0])
        for (const l of p.lines) expect(l.debitCents >= 0 && l.creditCents >= 0 && (l.debitCents > 0) !== (l.creditCents > 0) || amount === 0).toBe(true)
      }
    }
  })
})

describe('meal alone of the exploitant at a company taxed at IR (BOI-BNC-BASE-40-60-60)', () => {
  const meal = (amountCents: number, answers: Record<string, string>, exploitantMeal: { year: number } | null) => {
    const category = findCategory('repas-affaires')!
    const resolution = resolvePosting(category, answers, amountCents)
    if (resolution.status !== 'ready') throw new Error(resolution.status)
    return buildPostingLines({ category, posting: resolution.posting, kind: resolution.kind, side: 'debit', amountCents, recoveryRatio: null, exploitantMeal })
  }

  it('splits the charge: frais supplémentaires on 6256, the rest on 62568, VAT unchanged', () => {
    // 25 € TTC at 10 %: VAT 2,27 €, charge 22,73 €, non-deductible 9,10 / 25 of it
    const p = meal(2_500, { 'meal-guests': 'alone' }, { year: 2026 })
    expect(lines(p)).toEqual([
      ['6256', 1_446, 0],
      ['62568', 827, 0],
      ['44566', 227, 0],
    ])
    expect(p.mealSplit).toMatchObject({ deductibleInclTaxCents: 1_590 })
    expect(p.lines.reduce((s, l) => s + l.debitCents, 0)).toBe(2_500)
  })

  it('puts a meal below the home meal value entirely on 62568', () => {
    expect(lines(meal(500, { 'meal-guests': 'alone' }, { year: 2026 }))).toEqual([
      ['62568', 455, 0],
      ['44566', 45, 0],
    ])
  })

  it('isExploitantMeal reads only the answer alone', async () => {
    const { isExploitantMeal } = await import('../posting')
    expect(isExploitantMeal({ 'meal-guests': 'alone' })).toBe(true)
    expect(isExploitantMeal({ 'meal-guests': 'alone-employee' })).toBe(false)
    expect(isExploitantMeal({ 'meal-guests': 'guests' })).toBe(false)
  })

  it('leaves the meal whole without exploitantMeal (company at IS, employee, business meal)', () => {
    expect(lines(meal(2_500, { 'meal-guests': 'alone' }, null))).toEqual([
      ['6256', 2_273, 0],
      ['44566', 227, 0],
    ])
    expect(lines(meal(2_500, { 'meal-guests': 'alone-employee' }, null))).toEqual([
      ['6256', 2_273, 0],
      ['44566', 227, 0],
    ])
  })
})
