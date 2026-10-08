/**
 * Catalogue of simple mode (lib/simple/categories.ts): every category maps
 * to an account Kledg seeds in every chart (PCG 2026, lib/accounting/pcg-data.ts),
 * a default VAT rate and a recovery rule with its source; every question
 * branch books where its answer says. Sources: PCG art. 932-1 (accounts),
 * CGI art. 278, 279, 278-0 bis, 261 C (rates and exemptions), CGI ann. II
 * art. 206, IV, 2 and CGI art. 298, 4, 1°, a (recovery), BOI-BIC-CHG-20-30-10
 * (500 € HT tolerance).
 */

import { describe, expect, it } from 'vitest'
import { isOptionalPcgAccount, PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'
import {
  ALL_CATEGORIES,
  ASSET_THRESHOLD_EXCL_TAX_CENTS,
  CATEGORY_GROUPS,
  CATEGORY_IDS,
  REFUND_CATEGORIES,
  REFUND_GROUP,
  refundOf,
  categoriesForSide,
  categoryOfAccount,
  findCategory,
  searchCategories,
  SIMPLE_CATEGORIES,
} from '../categories'
import { questionApplies, resolvePosting } from '../posting'

/** [id, account, VAT rate (bp), recovery rule, kind, question] */
const EXPECTED: Array<[string, string, number, string, string, string?]> = [
  ['loyer', '6132', 2000, 'standard', 'expense', 'rent-vat'],
  ['coworking', '6132', 2000, 'standard', 'expense'],
  ['energie', '6061', 2000, 'standard', 'expense'],
  ['entretien-locaux', '6152', 2000, 'standard', 'expense'],
  ['maintenance', '6156', 2000, 'standard', 'expense'],
  ['materiel-informatique', '6063', 2000, 'standard', 'expense', 'durable'],
  ['mobilier', '6063', 2000, 'standard', 'expense', 'durable'],
  ['outillage', '6063', 2000, 'standard', 'expense', 'durable'],
  ['fournitures', '6064', 2000, 'standard', 'expense'],
  ['marchandises', '607', 2000, 'standard', 'expense'],
  ['matieres-premieres', '601', 2000, 'standard', 'expense'],
  ['emballages', '6026', 2000, 'standard', 'expense'],
  ['sous-traitance', '611', 2000, 'standard', 'expense'],
  ['prestations', '604', 2000, 'standard', 'expense'],
  ['livraisons', '6241', 2000, 'standard', 'expense'],
  ['telephone-internet', '626', 2000, 'standard', 'expense'],
  ['logiciels', '6511', 2000, 'standard', 'expense', 'supplier-vat'],
  ['hebergement-web', '6511', 2000, 'standard', 'expense', 'supplier-vat'],
  ['courrier', '626', 0, 'none', 'expense'],
  ['publicite', '623', 2000, 'standard', 'expense', 'supplier-vat'],
  ['salons', '6233', 2000, 'standard', 'expense'],
  ['cadeaux-clients', '6234', 2000, 'gift', 'expense'],
  ['deplacements', '6251', 1000, 'passenger-transport', 'expense'],
  ['hotel', '6256', 1000, 'staff-lodging', 'expense'],
  ['repas-affaires', '6257', 1000, 'standard', 'expense', 'meal-guests'],
  ['peages-parking', '6251', 2000, 'standard', 'expense'],
  ['carburant', '6061', 2000, 'fuel', 'expense', 'vehicle'],
  ['location-vehicule', '6135', 2000, 'passenger-vehicle', 'expense', 'vehicle'],
  ['entretien-vehicule', '6155', 2000, 'passenger-vehicle', 'expense', 'vehicle'],
  ['honoraires', '6226', 2000, 'standard', 'expense'],
  ['formalites', '6227', 0, 'none', 'expense'],
  ['assurances', '616', 0, 'none', 'expense'],
  ['formation', '6185', 2000, 'standard', 'expense'],
  ['documentation', '6181', 550, 'standard', 'expense'],
  ['cotisations-pro', '6281', 0, 'none', 'expense'],
  ['recrutement', '6284', 2000, 'standard', 'expense'],
  ['interim', '6211', 2000, 'standard', 'expense'],
  ['dons', '6238', 0, 'none', 'expense'],
  ['amendes', '6582', 0, 'none', 'expense'],
  ['frais-bancaires', '627', 0, 'detected', 'expense'],
  ['commissions-paiement', '6278', 0, 'detected', 'expense'],
  ['agios', '6616', 0, 'none', 'expense'],
  ['interets-emprunt', '6611', 0, 'none', 'expense'],
  ['remboursement-emprunt', '164', 0, 'none', 'other'],
  ['salaires', '421', 0, 'none', 'other'],
  ['remuneration-dirigeant', '6411', 0, 'none', 'expense'],
  ['charges-sociales', '431', 0, 'none', 'other'],
  ['retraite-salaries', '437', 0, 'none', 'other'],
  ['cotisations-dirigeant', '646', 0, 'none', 'expense'],
  ['mutuelle', '6452', 0, 'none', 'expense'],
  ['medecine-travail', '6475', 0, 'none', 'expense'],
  ['prelevement-source', '4421', 0, 'none', 'other'],
  ['impots-taxes', '6351', 0, 'none', 'expense'],
  ['impot-societes', '444', 0, 'none', 'other'],
  ['tva-payee', '4455', 0, 'none', 'other'],
  ['retrait-especes', '53', 0, 'none', 'other'],
  ['virement-interne', '58', 0, 'none', 'other'],
  ['compte-courant-associe', '455', 0, 'none', 'other'],
  ['dividendes', '457', 0, 'none', 'other'],
  ['ventes-prestations', '706', 2000, 'standard', 'income', 'sale-vat-rate'],
  ['ventes-marchandises', '707', 2000, 'standard', 'income', 'sale-vat-rate'],
  ['ventes-produits', '701', 2000, 'standard', 'income', 'sale-vat-rate'],
  ['paiement-client', '411', 0, 'none', 'other'],
  ['subvention', '741', 0, 'none', 'income'],
  ['interets-recus', '768', 0, 'none', 'income'],
  ['indemnites-recues', '758', 0, 'none', 'income'],
  ['versement-associe', '455', 0, 'none', 'other', 'owner-money'],
  ['apport-capital', '1013', 0, 'none', 'other'],
  ['emprunt-recu', '164', 0, 'none', 'other'],
  ['remboursement-tva', '44567', 0, 'none', 'other'],
  ['depot-garantie-rendu', '275', 0, 'none', 'other'],
  ['depot-especes', '53', 0, 'none', 'other'],
]

const seeded = new Set(PCG_ACCOUNTS.filter((a) => !isOptionalPcgAccount(a.code)).map((a) => a.code))
/**
 * Detailed accounts a category books to exactly, that Kledg creates when it
 * needs them: 44567 Crédit de TVA à reporter, created by the VAT settlement
 * (lib/vat-returns/prepare-vat-settlement.service.ts) when a credit arises.
 */
const CREATED_WHEN_NEEDED = new Set(['44567'])
const pcgCodes = new Set(PCG_ACCOUNTS.map((a) => a.code))
const DASHES = /[–—]/

describe('simple mode catalogue', () => {
  it('has between 50 and 80 categories with unique ids, all tested below', () => {
    expect(SIMPLE_CATEGORIES.length).toBeGreaterThanOrEqual(50)
    expect(SIMPLE_CATEGORIES.length).toBeLessThanOrEqual(80)
    expect(new Set(SIMPLE_CATEGORIES.map((c) => c.id)).size).toBe(SIMPLE_CATEGORIES.length)
    expect(SIMPLE_CATEGORIES.map((c) => c.id)).toEqual(EXPECTED.map((e) => e[0]))
  })

  it.each(EXPECTED)('%s books to %s at %i bp, rule %s (%s)', (id, account, rateBp, rule, kind, question) => {
    const category = findCategory(id)!
    expect(category.posting).toEqual({ account, vatRateBp: rateBp, vatRule: rule })
    expect(category.kind).toBe(kind)
    expect(category.question?.id).toBe(question)
    // The account exists in every chart Kledg seeds, or is a PCG account booked exactly
    if (CREATED_WHEN_NEEDED.has(account)) {
      expect(pcgCodes.has(account)).toBe(true)
      expect(category.exactAccount).toBe(true)
    } else expect(seeded.has(account), account).toBe(true)
    // Its source cites the PCG account
    expect(category.source).toContain(`compte ${account}`)
  })

  it('cites a source for every question and books every answer to a seeded account', () => {
    for (const category of SIMPLE_CATEGORIES) {
      const question = category.question
      if (!question) continue
      expect(question.source.length, category.id).toBeGreaterThan(10)
      for (const answer of question.answers) {
        const account = answer.posting.account ?? category.posting.account
        expect(seeded.has(account), `${category.id}/${answer.id}`).toBe(true)
      }
    }
  })

  it('writes plain French without dashes and a no-break space before colons and question marks', () => {
    for (const category of ALL_CATEGORIES) {
      const texts = [category.label, category.hint, category.group, category.notePrompt ?? '', category.question?.text ?? '', category.question?.help ?? '', ...(category.question?.answers.map((a) => a.label) ?? [])]
      for (const text of texts) {
        expect(DASHES.test(text), text).toBe(false)
        expect(/ [:?]/.test(text), text).toBe(false)
        // No account number in what a beginner reads
        expect(/\b\d{3,}\b/.test(text.replace(/\d+ ?€/g, '')), text).toBe(false)
      }
    }
  })

  it('offers expenses and movements for money out, income, refunds and movements for money in', () => {
    expect(categoriesForSide('debit').some((c) => c.kind === 'income' || c.kind === 'refund')).toBe(false)
    expect(categoriesForSide('credit').some((c) => c.kind === 'expense')).toBe(false)
    expect(categoriesForSide('credit').map((c) => c.id)).toEqual(expect.arrayContaining(['ventes-prestations', 'subvention', 'versement-associe', 'emprunt-recu', 'remboursement:telephone-internet']))
    expect(categoriesForSide('debit').map((c) => c.id)).toContain('tva-payee')
    expect(CATEGORY_GROUPS[0]).toBe('Locaux')
    expect(CATEGORY_GROUPS[CATEGORY_GROUPS.length - 1]).toBe(REFUND_GROUP)
  })

  it('derives the refund of every expense whose booking does not depend on the purchase (règlement ANC n° 2022-06)', () => {
    const expenses = SIMPLE_CATEGORIES.filter((c) => c.kind === 'expense')
    expect(REFUND_CATEGORIES.length).toBe(expenses.length - 4)
    // Durable equipment (may be a fixed asset) and gifts (VAT ceiling per person) stay with the accountant
    for (const id of ['materiel-informatique', 'mobilier', 'outillage', 'cadeaux-clients']) expect(refundOf(id), id).toBeNull()
    // Movements are already offered on both sides
    expect(refundOf('tva-payee')).toBeNull()
    const phone = refundOf('telephone-internet')!
    expect(phone).toMatchObject({ id: 'remboursement:telephone-internet', label: 'Remboursement : Téléphone et internet', kind: 'refund', group: REFUND_GROUP, posting: findCategory('telephone-internet')!.posting })
    expect(phone.source).toContain('règlement ANC n° 2022-06')
    expect(refundOf('carburant')?.question?.id).toBe('vehicle')
    expect(CATEGORY_IDS).toEqual(ALL_CATEGORIES.map((c) => c.id))
    expect(new Set(CATEGORY_IDS).size).toBe(CATEGORY_IDS.length)
  })

  it('finds categories by any word, without accents', () => {
    expect(searchCategories('telephone').map((c) => c.id)).toContain('telephone-internet')
    expect(searchCategories('Déjeuner').map((c) => c.id)).toEqual(['repas-affaires'])
    expect(searchCategories('urssaf').map((c) => c.id)).toEqual(['charges-sociales', 'cotisations-dirigeant'])
    expect(searchCategories('')).toHaveLength(SIMPLE_CATEGORIES.length)
  })

  it('maps an account back to the category that books there, the longest match first', () => {
    expect(categoryOfAccount('626100')?.id).toBe('telephone-internet')
    expect(categoryOfAccount('6257')?.id).toBe('repas-affaires')
    expect(categoryOfAccount('6256000')?.id).toBe('hotel')
    expect(categoryOfAccount('218300')?.id).toBe('materiel-informatique')
    expect(categoryOfAccount('706000')?.id).toBe('ventes-prestations')
    expect(categoryOfAccount('471000')).toBeNull()
  })

  it('picks among the categories sharing an account by the name of the rule or the bank label, never by guess', () => {
    // 6061 books both energy and fuel.
    expect(categoryOfAccount('606100', 'Carburant du véhicule')?.id).toBe('carburant')
    expect(categoryOfAccount('606100', 'CB STATION-SERVICE RELAIS DU PONT')?.id).toBe('carburant')
    expect(categoryOfAccount('606100', 'PRLV EDF Electricité')?.id).toBe('energie')
    // A hint naming neither (or both): no category, the rule is shown by its name.
    expect(categoryOfAccount('606100', 'Règle 12')).toBeNull()
    // Without a hint, the first category of the catalogue (the order of the catalogue decides).
    expect(categoryOfAccount('606100')?.id).toBe('energie')
  })
})

describe('questions, one test per branch', () => {
  const at = (id: string, amountCents: number, answers: Record<string, string> = {}) => resolvePosting(findCategory(id)!, answers, amountCents)

  describe('durable equipment (BOI-BIC-CHG-20-30-10: 500 € HT)', () => {
    it('expenses small equipment without asking: 600,00 € TTC is 500,00 € HT', () => {
      expect(questionApplies(findCategory('materiel-informatique')!, 60_000)).toBe(false)
      expect(at('materiel-informatique', 60_000)).toMatchObject({ status: 'ready', posting: { account: '6063' }, question: null })
      expect(ASSET_THRESHOLD_EXCL_TAX_CENTS).toBe(50_000)
    })

    it('asks above 500 € HT', () => {
      expect(questionApplies(findCategory('materiel-informatique')!, 60_002)).toBe(true)
      expect(at('materiel-informatique', 149_900)).toMatchObject({ status: 'pending', question: { id: 'durable' } })
    })

    it.each([
      ['materiel-informatique', '2183'],
      ['mobilier', '2184'],
      ['outillage', '2155'],
    ])('%s: durable goes to the fixed asset account %s, consumable stays a charge', (id, asset) => {
      expect(at(id, 149_900, { durable: 'durable' })).toMatchObject({ status: 'ready', posting: { account: asset, vatRule: 'standard' }, answers: { durable: 'durable' } })
      expect(at(id, 149_900, { durable: 'consumable' })).toMatchObject({ status: 'ready', posting: { account: '6063' } })
    })

    it('refuses an unknown answer with a French message', () => {
      const result = at('materiel-informatique', 149_900, { durable: 'peut-etre' })
      expect(result.status).toBe('invalid')
      expect(result.status === 'invalid' && result.message).toMatch(/^Réponse inconnue/)
    })
  })

  describe('business meal guests (CGI ann. II art. 206, IV)', () => {
    it('defaults to guests (6257 Réceptions) and books a meal alone to 6256 Missions', () => {
      expect(at('repas-affaires', 6_450)).toMatchObject({ status: 'ready', posting: { account: '6257' }, answers: { 'meal-guests': 'guests' } })
      expect(at('repas-affaires', 6_450, { 'meal-guests': 'alone' })).toMatchObject({ posting: { account: '6256', vatRule: 'standard' } })
    })
  })

  describe('vehicle type (CGI ann. II art. 206, IV, 2, 6°; CGI art. 298, 4, 1°, a)', () => {
    it.each([
      ['carburant', 'passenger-car', 'fuel'],
      ['carburant', 'utility', 'standard'],
      ['location-vehicule', 'passenger-car', 'passenger-vehicle'],
      ['location-vehicule', 'utility', 'standard'],
      ['entretien-vehicule', 'passenger-car', 'passenger-vehicle'],
      ['entretien-vehicule', 'utility', 'standard'],
    ])('%s for %s recovers by rule %s', (id, answer, rule) => {
      expect(at(id, 6_000, { vehicle: answer })).toMatchObject({ status: 'ready', posting: { vatRule: rule, account: findCategory(id)!.posting.account } })
    })

    it('asks before booking', () => {
      expect(at('carburant', 6_000)).toMatchObject({ status: 'pending', question: { id: 'vehicle' } })
    })
  })

  describe('VAT rate of a sale (CGI art. 278, 279, 278-0 bis, 281 quater, 262 ter, 259 and 283, 2)', () => {
    it.each([
      ['standard', 2000, 'standard'],
      ['intermediate', 1000, 'standard'],
      ['reduced', 550, 'standard'],
      ['super-reduced', 210, 'standard'],
      ['none', 0, 'none'],
    ])('a sale at %s collects %i bp', (answer, rateBp, rule) => {
      for (const id of ['ventes-prestations', 'ventes-marchandises', 'ventes-produits']) {
        expect(at(id, 12_000, { 'sale-vat-rate': answer })).toMatchObject({ status: 'ready', posting: { account: findCategory(id)!.posting.account, vatRateBp: rateBp, vatRule: rule }, kind: 'income' })
      }
    })

    it('defaults to 20 %, so a sale is confirmed without a question, and keeps the answer for the customer', () => {
      expect(at('ventes-prestations', 12_000)).toMatchObject({ status: 'ready', posting: { vatRateBp: 2000 }, answers: { 'sale-vat-rate': 'standard' } })
      expect(findCategory('ventes-prestations')!.question).toMatchObject({ reusable: true, defaultAnswerId: 'standard' })
    })
  })

  describe('money from a partner (PCG 455, 1013, 706; C. com. art. L223-32, L225-127)', () => {
    it('asks whether it is a loan to the company, with no default', () => {
      expect(findCategory('versement-associe')!.question!.text).toBe('Est-ce de l’argent que vous avez prêté à votre société ?')
      expect(at('versement-associe', 500_000)).toMatchObject({ status: 'pending', question: { id: 'owner-money' } })
    })

    it('books a loan to the current account, a capital increase to the capital, a purchase as a sale', () => {
      expect(at('versement-associe', 500_000, { 'owner-money': 'loan' })).toMatchObject({ status: 'ready', posting: { account: '455', vatRateBp: 0 }, kind: 'other' })
      expect(at('versement-associe', 500_000, { 'owner-money': 'capital' })).toMatchObject({ status: 'ready', posting: { account: '1013', vatRateBp: 0 }, kind: 'other' })
      expect(at('versement-associe', 12_000, { 'owner-money': 'sale' })).toMatchObject({ status: 'ready', posting: { account: '706', vatRateBp: 2000, vatRule: 'standard' }, kind: 'income' })
    })
  })

  describe('rent VAT (CGI art. 261 D, 2° and 260, 2°)', () => {
    it('books rent with or without VAT as the lease says', () => {
      expect(at('loyer', 120_000, { 'rent-vat': 'with-vat' })).toMatchObject({ posting: { account: '6132', vatRateBp: 2000, vatRule: 'standard' } })
      expect(at('loyer', 120_000, { 'rent-vat': 'without-vat' })).toMatchObject({ posting: { account: '6132', vatRateBp: 0, vatRule: 'none' } })
      expect(at('loyer', 120_000)).toMatchObject({ status: 'pending' })
    })
  })
})

describe('meal question at a company taxed at IR', () => {
  it('offers the employee answer and the exploitant label only at IR', async () => {
    const { answersFor, findCategory: find } = await import('../categories')
    const question = find('repas-affaires')!.question!
    expect(answersFor(question, false).map((a) => a.shownLabel)).toEqual(['Avec des clients ou partenaires', 'Seul, en déplacement'])
    expect(answersFor(question, true).map((a) => [a.id, a.shownLabel])).toEqual([
      ['guests', 'Avec des clients ou partenaires'],
      ['alone', 'Vous ou un associé, seul en déplacement'],
      ['alone-employee', 'Un salarié, seul en déplacement'],
    ])
  })
})
