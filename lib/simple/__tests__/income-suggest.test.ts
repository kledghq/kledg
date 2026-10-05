/**
 * "Recettes à vérifier" (docs/categories-simples.md): the suggestion engine
 * on French credit labels as banks write them, and the matching of a credit
 * with the open sales invoices (lib/simple/match-invoice.ts):
 * - a customer transfer or a cheque deposit that pays an invoice (number,
 *   SIREN or customer name, exact amount or part payment), before any
 *   category so a sale already invoiced is never booked twice;
 * - public aid (CAF, Bpifrance, ASP, France Travail, région) as a subsidy
 *   (PCG 74), a loan released as a loan (164), a VAT refund (44567);
 * - a supplier refund as the refund of the expense (règlement ANC
 *   n° 2022-06: no transfer of charges, the charge is reduced);
 * - money from a partner of the company: a question, never a guess
 *   (current account 455, capital 1013 or a sale);
 * - a known customer without an invoice: a sale, at the VAT rate answered
 *   for that customer before.
 */

import { describe, expect, it } from 'vitest'
import { matchInvoice, significantWords, type OpenInvoice } from '../match-invoice'
import { suggestCategory, type EngineContext, type EngineTransaction, type HistoryChoice } from '../suggest'

const N = ' '

const credit = (label: string, amountCents = 120_000, options: Partial<EngineTransaction> = {}): EngineTransaction => ({
  side: 'credit',
  amountCents,
  label,
  counterpartyName: null,
  bankCategory: null,
  ...options,
})

const invoice = (id: string, number: string, customerName: string, remainingCents: number, options: Partial<OpenInvoice> = {}): OpenInvoice => ({
  id,
  number,
  customerName,
  customerSiren: null,
  remainingCents,
  dueDate: '2026-10-15',
  ...options,
})

const INVOICES: OpenInvoice[] = [
  invoice('inv-nord', 'F-2026-012', 'SAS Studio Nord', 120_000, { customerSiren: '940000501', dueDate: '2026-10-01' }),
  invoice('inv-lumen', 'F-2026-013', 'Atelier Lumen', 54_000, { dueDate: '2026-10-20' }),
  invoice('inv-martin', 'F-2026-014', 'Martin Conseil', 360_000, { dueDate: '2026-11-05' }),
]

const suggest = (tx: EngineTransaction, context: Partial<EngineContext> = {}) => suggestCategory(tx, { history: [], ...context })

/** [label, amount in cents, expected category (null: à classer), confidence] with no invoice open. */
const CORPUS: Array<[string, number, string | null, 'high' | 'medium' | 'low']> = [
  ['VIR SEPA CAF DE PARIS PSU SEPTEMBRE', 1_850_000, 'subvention', 'medium'],
  ['VIR CAISSE D ALLOCATIONS FAMILIALES', 420_000, 'subvention', 'medium'],
  ['VIR SEPA BPIFRANCE SUBVENTION INNOVATION', 3_000_000, 'subvention', 'high'],
  ['VIR BPI FRANCE AIDE BOURSE FRENCH TECH', 3_000_000, 'subvention', 'high'],
  ['VIR ASP AIDE A L APPRENTISSAGE', 50_000, 'subvention', 'high'],
  ['VIR FRANCE TRAVAIL AIDE EMBAUCHE', 150_000, 'subvention', 'medium'],
  ['VIR CONSEIL REGIONAL SUBVENTION', 500_000, 'subvention', 'high'],
  ['VIR SEPA BPIFRANCE DEBLOCAGE PRET AMORCAGE', 5_000_000, 'emprunt-recu', 'high'],
  ['DEBLOCAGE PRET 00012345', 2_500_000, 'emprunt-recu', 'high'],
  ['VIR SEPA BPIFRANCE', 1_000_000, null, 'low'],
  ['VIR SEPA DGFIP REMBOURSEMENT CREDIT TVA', 184_300, 'remboursement-tva', 'high'],
  ['VIR DGFIP REMBOURSEMENT EXCEDENT IS', 92_000, 'impot-societes', 'high'],
  ['VIR DGFIP REMBOURSEMENT 2026', 92_000, null, 'low'],
  ['VIR SNCF REMBOURSEMENT BILLET 12/09', 8_900, 'remboursement:deplacements', 'medium'],
  ['VIR SEPA OVH SAS REMBOURSEMENT', 2_399, 'remboursement:hebergement-web', 'medium'],
  ['AVOIR ADOBE SYSTEMS', 5_999, 'remboursement:logiciels', 'medium'],
  ['REMBOURSEMENT AMAZON PAYMENTS EU', 3_499, null, 'low'],
  ['VIR AXA FRANCE INDEMNISATION SINISTRE', 230_000, 'indemnites-recues', 'high'],
  ['VIR LIBERATION DU CAPITAL', 100_000, 'apport-capital', 'high'],
  ['VIR M DUPONT APPORT EN COMPTE COURANT', 500_000, 'compte-courant-associe', 'medium'],
  ['INTERETS CREDITEURS 3EME TRIMESTRE', 1_234, 'interets-recus', 'high'],
  ['VERSEMENT ESPECES AGENCE OPERA', 35_000, 'depot-especes', 'high'],
  ['VIR RESTITUTION DEPOT DE GARANTIE BAIL', 240_000, 'depot-garantie-rendu', 'medium'],
  ['VIR STRIPE PAYMENTS EUROPE', 48_200, 'ventes-prestations', 'medium'],
  ['REMISE CHEQUE 1234567', 54_000, null, 'low'],
  ['VIR SEPA MARTIN CONSEIL FACTURE 2026-14', 360_000, null, 'low'],
  ['VIR INSTANTANE M JEAN DUPONT', 500_000, null, 'low'],
]

describe('money in on French bank labels, without an open invoice', () => {
  it.each(CORPUS)('%s (%i): %s, %s', (label, amount, category, confidence) => {
    const s = suggest(credit(label, amount))
    expect(s.categoryId).toBe(category)
    expect(s.confidence).toBe(confidence)
    expect(s.invoice).toBeNull()
    if (category === null) expect(s.reason.length).toBeGreaterThan(0)
  })

  it('says why a credit stays to identify', () => {
    expect(suggest(credit('REMISE CHEQUE 1234567')).reason).toBe(`Remise de chèque${N}: choisissez ce qu’il paie (une vente, une facture).`)
    expect(suggest(credit('VIR DGFIP REMBOURSEMENT 2026')).reason).toMatch(/^Versement des impôts/)
    expect(suggest(credit('VIR SEPA BPIFRANCE')).reason).toMatch(/prêt ou d’une subvention/)
    expect(suggest(credit('REMBOURSEMENT AMAZON PAYMENTS EU')).reason).toBe(`Remboursement${N}: choisissez la dépense qui vous est remboursée.`)
  })

  it('proposes the refund of what the supplier is usually paid for, never the expense itself', () => {
    const s = suggest(credit('VIR SNCF REMBOURSEMENT BILLET 12/09', 8_900))
    expect(s).toMatchObject({ categoryId: 'remboursement:deplacements', source: 'payee', reason: `Remboursement reconnu${N}: transport`, bulkConfirmable: false })
    // The same supplier without a word of refund: nothing
    expect(suggest(credit('VIR SNCF', 8_900)).categoryId).toBeNull()
  })

  it('never uses a choice made on money out for money in: a VAT payment says nothing about a VAT refund', () => {
    const paidVat: HistoryChoice[] = [
      { categoryId: 'tva-payee', day: '2026-07-20', side: 'debit' },
      { categoryId: 'tva-payee', day: '2026-08-20', side: 'debit' },
    ]
    expect(suggest(credit('VIR SEPA DGFIP REMBOURSEMENT CREDIT TVA', 184_300), { history: paidVat })).toMatchObject({ categoryId: 'remboursement-tva', source: 'payee' })
  })
})

describe('money from a partner of the company', () => {
  const owners = ['Jean Dupont']

  it('asks whether it is a loan, a capital increase or a sale, and keeps it out of "Tout confirmer"', () => {
    const s = suggest(credit('VIR INSTANTANE M JEAN DUPONT', 500_000), { owners })
    expect(s).toMatchObject({ categoryId: 'versement-associe', source: 'owner', confidence: 'medium', bulkConfirmable: false, reason: 'Une question avant de classer' })
    expect(s.pendingQuestion?.id).toBe('owner-money')
    expect(s.pendingQuestion?.text).toBe(`Est-ce de l’argent que vous avez prêté à votre société${N}?`)
    expect(s.pendingQuestion?.answers.map((a) => a.id)).toEqual(['loan', 'capital', 'sale'])
  })

  it('never takes money paid to the partner for money from the partner', () => {
    expect(suggestCategory({ ...credit('VIR INSTANTANE M JEAN DUPONT', 500_000), side: 'debit' }, { history: [], owners }).categoryId).toBeNull()
    expect(suggest(credit('VIR INSTANTANE M PAUL DURAND', 500_000), { owners }).categoryId).toBeNull()
  })
})

describe('money from a known customer without an invoice', () => {
  it('is a sale of the category of its usual account, at the VAT rate of the catalogue', () => {
    const customers = [
      { name: 'Atelier Lumière', categoryId: null },
      { name: 'SARL Boutique Rive', categoryId: 'ventes-marchandises' },
    ]
    expect(suggest(credit('VIR SEPA ATELIER LUMIERE', 54_000), { customers })).toMatchObject({
      categoryId: 'ventes-prestations',
      source: 'customer',
      confidence: 'medium',
      reason: 'Votre client Atelier Lumière',
      answers: { 'sale-vat-rate': 'standard' },
    })
    expect(suggest(credit('VIR BOUTIQUE RIVE CDE 88', 30_000), { customers }).categoryId).toBe('ventes-marchandises')
  })

  it('keeps the VAT rate answered for the customer, and confirms repeated sales in bulk', () => {
    const history: HistoryChoice[] = ['2026-08-05', '2026-09-05'].map((day) => ({ categoryId: 'ventes-prestations', day, side: 'credit', answers: { 'sale-vat-rate': 'intermediate' } }))
    expect(suggest(credit('VIR SEPA ATELIER LUMIERE', 55_000), { history })).toMatchObject({
      categoryId: 'ventes-prestations',
      source: 'history',
      confidence: 'high',
      answers: { 'sale-vat-rate': 'intermediate' },
      pendingQuestion: null,
      bulkConfirmable: true,
    })
  })
})

describe('the open invoice a credit pays', () => {
  it('names the invoice by its number with the exact amount: high, before a rule or the history', () => {
    const s = suggest(credit('VIR SEPA STUDIO NORD FACT F2026012', 120_000), {
      invoices: INVOICES,
      rule: { ruleId: 'r1', ruleName: 'Studio Nord', categoryId: 'ventes-prestations' },
      history: [{ categoryId: 'ventes-prestations', day: '2026-09-01', side: 'credit' }],
    })
    expect(s).toMatchObject({
      categoryId: null,
      ruleId: null,
      source: 'invoice',
      confidence: 'high',
      bulkConfirmable: true,
      invoice: { invoiceId: 'inv-nord', number: 'F-2026-012', customerName: 'SAS Studio Nord', remainingCents: 120_000, partial: false },
      reason: `Règle la facture n°${N}F-2026-012 de SAS Studio Nord`,
    })
  })

  it('names the invoice by the SIREN of the customer, spaces allowed, or by the customer name', () => {
    expect(suggest(credit('VIR SEPA 940 000 501 REGLEMENT', 120_000), { invoices: INVOICES }).invoice?.invoiceId).toBe('inv-nord')
    expect(suggest(credit('VIR SEPA ATELIER LUMEN', 54_000), { invoices: INVOICES })).toMatchObject({ confidence: 'high', invoice: { invoiceId: 'inv-lumen' } })
    expect(suggest(credit('VIR', 54_000, { counterpartyName: 'Atelier Lumen' }), { invoices: INVOICES }).invoice?.invoiceId).toBe('inv-lumen')
  })

  it('proposes a cheque of the exact amount of a single open invoice, at medium confidence', () => {
    const s = suggest(credit('REMISE CHEQUE 1234567', 54_000), { invoices: INVOICES })
    expect(s).toMatchObject({ confidence: 'medium', bulkConfirmable: false, invoice: { invoiceId: 'inv-lumen' }, reason: `Même montant que la facture n°${N}F-2026-013 de Atelier Lumen` })
  })

  it('recognises a part payment that names the invoice', () => {
    const s = suggest(credit('VIR MARTIN CONSEIL ACOMPTE F-2026-014', 120_000), { invoices: INVOICES })
    expect(s).toMatchObject({ confidence: 'medium', invoice: { invoiceId: 'inv-martin', partial: true }, reason: `Paiement partiel de la facture n°${N}F-2026-014, sur 3 600,00 € à payer` })
  })

  it('never proposes an invoice for money out', () => {
    expect(suggestCategory({ ...credit('PRLV STUDIO NORD F2026012', 120_000), side: 'debit' }, { history: [], invoices: INVOICES }).invoice).toBeNull()
  })
})

describe('matchInvoice', () => {
  const at = (label: string, amountCents: number, invoices: OpenInvoice[] = INVOICES, counterpartyName: string | null = null) => matchInvoice({ amountCents, label, counterpartyName }, invoices)

  it('leaves out legal forms and short words of a customer name', () => {
    expect(significantWords('SAS Studio Nord')).toEqual(['STUDIO', 'NORD'])
    expect(significantWords('SARL Le Café de la Gare')).toEqual(['CAFE', 'GARE'])
  })

  it('refuses an amount above what is left to pay', () => {
    expect(at('VIR STUDIO NORD F-2026-012', 120_001)).toBeNull()
  })

  it('says nothing when the same amount is open on invoices of different customers', () => {
    const twins = [invoice('a', 'A-1001', 'Alpha Design', 50_000), invoice('b', 'B-2002', 'Beta Studio', 50_000)]
    expect(at('REMISE CHEQUE 99', 50_000, twins)).toBeNull()
  })

  it('takes the oldest of several invoices of the customer for the same amount, at medium confidence', () => {
    const monthly = [invoice('sep', 'F-0901', 'Atelier Lumen', 54_000, { dueDate: '2026-09-30' }), invoice('aug', 'F-0801', 'Atelier Lumen', 54_000, { dueDate: '2026-08-31' })]
    expect(at('VIR ATELIER LUMEN', 54_000, monthly)).toMatchObject({ invoiceId: 'aug', score: 0.7 })
    // The number decides between them
    expect(at('VIR ATELIER LUMEN F-0901', 54_000, monthly)).toMatchObject({ invoiceId: 'sep', score: 0.95 })
  })

  it('takes a part payment naming the customer only when the customer has a single open invoice', () => {
    expect(at('VIR SEPA MARTIN CONSEIL', 100_000)).toMatchObject({ invoiceId: 'inv-martin', partial: true, score: 0.6 })
    const two = [...INVOICES, invoice('inv-martin-2', 'F-2026-020', 'Martin Conseil', 240_000)]
    expect(at('VIR SEPA MARTIN CONSEIL', 100_000, two)).toBeNull()
  })

  it('ignores invoice numbers too short to be told from an amount or a date', () => {
    expect(at('VIR 12 SEPT', 10_000, [invoice('x', '12', 'Client Y', 20_000)])).toBeNull()
  })
})
