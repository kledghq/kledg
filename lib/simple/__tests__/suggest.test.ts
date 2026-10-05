/**
 * Suggestion engine of simple mode (lib/simple/suggest.ts) on a corpus of
 * French bank labels as Qonto, BNP, Société Générale, Crédit Agricole and
 * Shine write them: priority of the signals (rules, history, payee
 * dictionary, keywords, bank category), routing of URSSAF and DGFIP, the
 * side of the transaction, confidence thresholds and "à classer".
 */

import { describe, expect, it } from 'vitest'
import { displayNameOf } from '../payees'
import { suggestCategory, type EngineTransaction, type HistoryChoice } from '../suggest'

const tx = (label: string, options: Partial<EngineTransaction> = {}): EngineTransaction => ({
  side: 'debit',
  amountCents: 4_799,
  label,
  counterpartyName: null,
  bankCategory: null,
  ...options,
})
const suggest = (t: EngineTransaction, history: HistoryChoice[] = []) => suggestCategory(t, { history })

/** [label, side, expected category (null: à classer), expected confidence] */
const CORPUS: Array<[string, 'debit' | 'credit', string | null, 'high' | 'medium' | 'low']> = [
  ['PRLV SEPA FREE PRO', 'debit', 'telephone-internet', 'high'],
  ['PRLV SEPA FREE MOBILE 0612345678', 'debit', 'telephone-internet', 'high'],
  ['PRLV SEPA ORANGE SA FACTURE 123456789', 'debit', 'telephone-internet', 'high'],
  ['PRLV SEPA BOUYGUES TELECOM', 'debit', 'telephone-internet', 'high'],
  ['CB SNCF CONNECT PARIS 29/09', 'debit', 'deplacements', 'high'],
  ['CARTE X1234 OUIGO 12/03', 'debit', 'deplacements', 'high'],
  ['CB UBER *TRIP HELP.UBER.COM', 'debit', 'deplacements', 'high'],
  ['CB UBER EATS PARIS', 'debit', 'repas-affaires', 'medium'],
  ['CB AIR FRANCE 0572345678901', 'debit', 'deplacements', 'high'],
  ['CB BOOKING.COM HOTEL', 'debit', 'hotel', 'high'],
  ['CB IBIS PARIS GARE DE LYON', 'debit', 'hotel', 'high'],
  ['PRLV ADOBE SYSTEMS SOFTWARE IRELAND', 'debit', 'logiciels', 'high'],
  ['CB MICROSOFT*365 MSBILL.INFO', 'debit', 'logiciels', 'high'],
  ['CB NOTION LABS INC', 'debit', 'logiciels', 'high'],
  ['CB OPENAI *CHATGPT SUBSCR', 'debit', 'logiciels', 'high'],
  ['CB GOOGLE*ADS1234567', 'debit', 'publicite', 'high'],
  ['CB FACEBK *ABCD12345', 'debit', 'publicite', 'high'],
  ['CB GOOGLE *WORKSPACE', 'debit', 'logiciels', 'high'],
  ['PRLV SEPA OVH SAS', 'debit', 'hebergement-web', 'high'],
  ['CB APPLE STORE OPERA', 'debit', 'materiel-informatique', 'high'],
  ['CB TOTALENERGIES STATION A6', 'debit', 'carburant', 'high'],
  ['PRLV SEPA TOTALENERGIES ELECTRICITE ET GAZ', 'debit', 'energie', 'high'],
  ['PRLV SEPA EDF CLIENTS PARTICULIERS', 'debit', 'energie', 'high'],
  ['CB VINCI AUTOROUTES', 'debit', 'peages-parking', 'high'],
  ['CB INDIGO PARKING GARE', 'debit', 'peages-parking', 'high'],
  ['PRLV SEPA AXA FRANCE IARD', 'debit', 'assurances', 'high'],
  ['PRLV SEPA HISCOX RC PRO', 'debit', 'assurances', 'high'],
  ['PRLV SEPA URSSAF ILE DE FRANCE', 'debit', 'charges-sociales', 'medium'],
  ['PRLV SEPA URSSAF TI COTISATIONS', 'debit', 'cotisations-dirigeant', 'high'],
  ['PRLV SEPA CIPAV RETRAITE', 'debit', 'cotisations-dirigeant', 'high'],
  ['PRLV SEPA DGFIP TVA 2026T3', 'debit', 'tva-payee', 'high'],
  ['PRLV SEPA DGFIP IMPOT IS ACOMPTE', 'debit', 'impot-societes', 'high'],
  ['PRLV SEPA DIRECTION GENERALE DES FINANCES PUBLIQUES CFE 2026', 'debit', 'impots-taxes', 'high'],
  ['PRLV SEPA DGFIP PAS SEPTEMBRE', 'debit', 'prelevement-source', 'high'],
  ['PRLV SEPA DGFIP 12345678', 'debit', null, 'low'],
  ['VIR SEPA DGFIP REMBOURSEMENT CREDIT TVA', 'credit', 'remboursement-tva', 'high'],
  ['CB ANTAI AMENDE', 'debit', 'amendes', 'high'],
  ['FRAIS TENUE DE COMPTE', 'debit', 'frais-bancaires', 'medium'],
  ['COTISATION CARTE BUSINESS', 'debit', 'frais-bancaires', 'medium'],
  ['QONTO ABONNEMENT ESSENTIAL', 'debit', 'frais-bancaires', 'high'],
  ['AGIOS TRIMESTRIELS', 'debit', 'agios', 'high'],
  ['ECHEANCE PRET 00012345', 'debit', 'remboursement-emprunt', 'medium'],
  ['RETRAIT DAB 15/09 PARIS', 'debit', 'retrait-especes', 'high'],
  ['CB LE PETIT BISTROT', 'debit', 'repas-affaires', 'medium'],
  ['CB RESTAURANT CHEZ PAUL', 'debit', 'repas-affaires', 'medium'],
  ['VIR LOYER OCTOBRE SCI DES LILAS', 'debit', 'loyer', 'medium'],
  ['VIR SALAIRE SEPTEMBRE M DUPONT', 'debit', 'salaires', 'medium'],
  ['CB BUREAU VALLEE', 'debit', 'fournitures', 'high'],
  ['CB AMAZON PAYMENTS EU', 'debit', null, 'low'],
  ['CB AMZN MKTP FR', 'debit', null, 'low'],
  ['PAYPAL *ETSY', 'debit', null, 'low'],
  ['PRLV SEPA STRIPE FEES', 'debit', 'commissions-paiement', 'medium'],
  ['VIR STRIPE PAYMENTS EUROPE', 'credit', 'ventes-prestations', 'medium'],
  ['CB LA POSTE AGENCE', 'debit', 'courrier', 'medium'],
  ['CB COLISSIMO', 'debit', 'livraisons', 'high'],
  ['PRLV INFOGREFFE', 'debit', 'formalites', 'high'],
  ['VIR LIBERATION DU CAPITAL', 'credit', 'apport-capital', 'high'],
  ['VIR SEPA SUBVENTION REGION', 'credit', 'subvention', 'high'],
  ['VIR SEPA MARTIN CONSEIL FACTURE 2026-14', 'credit', null, 'low'],
  ['CB SARL DUBOIS', 'debit', null, 'low'],
  ['VIR INSTANTANE M JEAN DUPONT', 'debit', null, 'low'],
]

describe('suggestion engine on French bank labels', () => {
  it.each(CORPUS)('%s (%s): %s, %s', (label, side, category, confidence) => {
    const s = suggest(tx(label, { side }))
    expect(s.categoryId).toBe(category)
    expect(s.confidence).toBe(confidence)
    if (category === null) expect(s.reason.length).toBeGreaterThan(0)
  })

  it('recognises well known payees with a high majority (realistic corpus)', () => {
    const recognised = CORPUS.filter(([label, side]) => suggest(tx(label, { side })).categoryId !== null)
    expect(recognised.length / CORPUS.length).toBeGreaterThan(0.8)
  })

  it('says why a recognised payee stays to classify', () => {
    expect(suggest(tx('PRLV SEPA DGFIP 12345678')).reason).toMatch(/précisez lequel/)
    expect(suggest(tx('CB AMAZON PAYMENTS EU')).reason).toMatch(/choisissez ce que vous avez acheté/)
    expect(suggest(tx('CB SARL DUBOIS')).reason).toBe('À classer : choisissez la catégorie')
  })

  it('gives the payee as the reason, like the mockup', () => {
    expect(suggest(tx('CB SNCF CONNECT PARIS')).reason).toBe('Reconnu : transport')
    expect(suggest(tx('CB LE PETIT BISTROT')).reason).toBe('Le libellé mentionne « bistrot »')
  })
})

describe('signal priority', () => {
  const history = (categoryId: string, days: string[], answers?: Record<string, string>): HistoryChoice[] => days.map((day) => ({ categoryId, day, answers }))

  it('puts the company rule first, with the rule applied as it is', () => {
    const s = suggestCategory(tx('PRLV SEPA FREE PRO'), {
      rule: { ruleId: 'r1', ruleName: 'Free', categoryId: 'logiciels' },
      history: history('telephone-internet', ['2026-09-01']),
    })
    expect(s).toMatchObject({ source: 'rule', ruleId: 'r1', categoryId: 'logiciels', confidence: 'high', bulkConfirmable: true, reason: 'Votre règle « Free »' })
  })

  it('keeps a rule whose account is not in the catalogue, without a category', () => {
    const s = suggestCategory(tx('VIR CLIENT X', { side: 'credit' }), { rule: { ruleId: 'r2', ruleName: 'Client X', categoryId: null }, history: [] })
    expect(s).toMatchObject({ categoryId: null, ruleId: 'r2', confidence: 'high' })
  })

  it('prefers the history of the counterparty to the dictionary', () => {
    const s = suggest(tx('PRLV SEPA FREE PRO'), history('logiciels', ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']))
    expect(s).toMatchObject({ categoryId: 'logiciels', source: 'history', confidence: 'high', reason: 'Comme les 6 dernières fois' })
    const once = suggest(tx('CB SARL DUBOIS'), history('sous-traitance', ['2026-09-01']))
    expect(once).toMatchObject({ categoryId: 'sous-traitance', confidence: 'medium', reason: 'Comme la dernière fois', bulkConfirmable: false })
  })

  it('weighs diverging choices and leaves the line to classify below the threshold', () => {
    // 2 of 3: 0,8 x 2/3 is below the medium threshold, nothing else is known
    const mixed = [...history('fournitures', ['2026-09-01', '2026-07-01']), ...history('materiel-informatique', ['2026-08-01'])]
    expect(suggest(tx('CB SARL DUBOIS'), mixed)).toMatchObject({ categoryId: null, confidence: 'low' })
    // 3 of 4: medium, the most frequent choice
    const mostly = [...history('fournitures', ['2026-09-01', '2026-07-01', '2026-06-01']), ...history('materiel-informatique', ['2026-08-01'])]
    expect(suggest(tx('CB SARL DUBOIS'), mostly)).toMatchObject({ categoryId: 'fournitures', source: 'history', confidence: 'medium', reason: 'Choisi 3 fois sur les 4 derniers paiements' })
    // Diverging history below the threshold: the dictionary decides
    const even = [...history('fournitures', ['2026-09-01']), ...history('publicite', ['2026-08-01'])]
    expect(suggest(tx('CB BUREAU VALLEE'), even)).toMatchObject({ categoryId: 'fournitures', source: 'payee' })
  })

  it('uses the bank category last, with medium confidence', () => {
    expect(suggest(tx('CB SARL DUBOIS', { bankCategory: 'restaurant_and_bar' }))).toMatchObject({ categoryId: 'repas-affaires', source: 'bank', confidence: 'medium' })
    expect(suggest(tx('CB SARL DUBOIS', { bankCategory: 'other_expense' }))).toMatchObject({ categoryId: null, confidence: 'low' })
  })

  it('never proposes an income for money out nor an expense for money in: money in from a supplier is its refund', () => {
    // A supplier usually paid gives money back: the refund of that expense, medium at most
    expect(suggest(tx('VIR SARL DUBOIS', { side: 'credit' }), history('fournitures', ['2026-09-01', '2026-08-01']))).toMatchObject({
      categoryId: 'remboursement:fournitures',
      confidence: 'medium',
      bulkConfirmable: false,
    })
    expect(suggest(tx('CB SARL DUBOIS'), history('ventes-prestations', ['2026-09-01', '2026-08-01']))).toMatchObject({ categoryId: null })
    // A payee of money out is used for money in only as the refund of what it is paid for
    expect(suggest(tx('VIR ORANGE REMBOURSEMENT', { side: 'credit' })).categoryId).toBe('remboursement:telephone-internet')
    expect(suggest(tx('VIR ORANGE', { side: 'credit' })).categoryId).toBeNull()
  })
})

describe('questions and bulk confirmation', () => {
  it('asks whether a computer above 500 € HT is durable, and keeps it out of "Tout confirmer"', () => {
    const s = suggest(tx('CB APPLE STORE OPERA', { amountCents: 149_900 }))
    expect(s).toMatchObject({ categoryId: 'materiel-informatique', confidence: 'high', bulkConfirmable: false, reason: 'Une question avant de classer' })
    expect(s.pendingQuestion?.id).toBe('durable')
    expect(suggest(tx('CB APPLE STORE OPERA', { amountCents: 2_999 }))).toMatchObject({ pendingQuestion: null, bulkConfirmable: true })
  })

  it('reuses the vehicle answered for the same counterparty, never a durable purchase', () => {
    const fuel = suggest(tx('CB TOTALENERGIES STATION A6', { amountCents: 6_000 }), [{ categoryId: 'carburant', day: '2026-09-01', answers: { vehicle: 'utility' } }])
    expect(fuel).toMatchObject({ categoryId: 'carburant', answers: { vehicle: 'utility' }, pendingQuestion: null })
    const first = suggest(tx('CB TOTALENERGIES STATION A6', { amountCents: 6_000 }))
    expect(first.pendingQuestion?.id).toBe('vehicle')
    const computer = suggest(tx('CB APPLE STORE OPERA', { amountCents: 149_900 }), [
      { categoryId: 'materiel-informatique', day: '2026-09-01', answers: { durable: 'durable' } },
      { categoryId: 'materiel-informatique', day: '2026-08-01', answers: { durable: 'durable' } },
    ])
    expect(computer.pendingQuestion?.id).toBe('durable')
  })

  it('answers the meal question by default (with guests) so the line can be confirmed with its note', () => {
    expect(suggest(tx('CB LE PETIT BISTROT'), [{ categoryId: 'repas-affaires', day: '2026-09-01' }, { categoryId: 'repas-affaires', day: '2026-08-01' }])).toMatchObject({
      categoryId: 'repas-affaires',
      answers: { 'meal-guests': 'guests' },
      pendingQuestion: null,
      bulkConfirmable: true,
    })
  })

  it('confirms in bulk only high confidence lines', () => {
    expect(suggest(tx('PRLV SEPA FREE PRO')).bulkConfirmable).toBe(true)
    expect(suggest(tx('PRLV SEPA URSSAF ILE DE FRANCE')).bulkConfirmable).toBe(false)
    expect(suggest(tx('CB SARL DUBOIS')).bulkConfirmable).toBe(false)
  })

  it('is deterministic', () => {
    for (const [label, side] of CORPUS) expect(suggest(tx(label, { side }))).toEqual(suggest(tx(label, { side })))
  })
})

describe('displayNameOf', () => {
  it('names the payee as the user reads it', () => {
    expect(displayNameOf(null, 'PRLV SEPA FREE PRO')).toBe('Free Pro')
    expect(displayNameOf('SNCF Connect', 'CB SNCF CONNECT PARIS')).toBe('SNCF Connect')
    expect(displayNameOf(null, null)).toBe('Opération bancaire')
  })
})
