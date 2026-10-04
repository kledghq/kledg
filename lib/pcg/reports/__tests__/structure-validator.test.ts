/**
 * Structure checks of the statements against PCG art. 821-1 (bilan) and
 * art. 821-2 (compte de résultat): missing mandatory posts are errors,
 * missing sub-posts are warnings, an unbalanced bilan is an error (PCG art.
 * 511-1 as cited by the validator). The complete structures are covered by
 * lib/reports/__tests__/pcg-structure.test.ts; these are the gaps.
 */

import { describe, expect, it } from 'vitest'
import { validateBalanceSheetStructure, validateIncomeStatementStructure } from '@/lib/pcg/reports/structure-validator'
import type { CompleteBalanceSheet } from '@/lib/reports/types'

const post = { total: 0, accounts: [] }
const fixed = (net = 0) => ({ brut: net, amortissements: 0, net, details: [] })

/** A balance sheet with only the posts given (the validator reads what is present). */
function balanceSheet(actif: Record<string, unknown>, passif: Record<string, unknown>): CompleteBalanceSheet {
  return { actif, passif, details: { class1: [], class2: [], class3: [], class4: [], class5: [] } } as unknown as CompleteBalanceSheet
}

type IncomeStatement = Parameters<typeof validateIncomeStatementStructure>[0]

describe('validateBalanceSheetStructure (PCG art. 821-1)', () => {
  it('reports an unbalanced bilan with both totals', () => {
    const result = validateBalanceSheetStructure(
      balanceSheet(
        { total: 1000, actifImmobilise: { incorporelles: fixed(), corporelles: fixed() }, actifCirculant: { stocks: post, creances: post } },
        { total: 990.5, capitauxPropres: { capital: post, reserves: post }, dettes: { dettesFournisseurs: post, dettesFiscalesSociales: post } },
      ),
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(["Le bilan n'est pas équilibré : écart de 9.50€ (Actif: 1000.00€, Passif: 990.50€)"])
  })

  it('makes the missing mandatory posts errors (art. 821-1 III, IV on both sides, I on the passif)', () => {
    const result = validateBalanceSheetStructure(balanceSheet({ total: 0 }, { total: 0 }))
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      'Poste "Actif immobilisé" manquant (Art. 821-1 III)',
      'Poste "Actif circulant" manquant (Art. 821-1 IV)',
      'Poste "Capitaux propres" manquant (Art. 821-1 I)',
      'Poste "Dettes" manquant (Art. 821-1 IV)',
    ])
    expect(result.warnings).toEqual([
      'Poste "Capital souscrit non appelé" manquant (Art. 821-1 I)',
      'Poste "Frais d\'établissement" manquant (Art. 821-1 II)',
      'Poste "Frais d\'émission des emprunts" manquant (Art. 821-1 V)',
      'Poste "Primes de remboursement des emprunts" manquant (Art. 821-1 VI)',
      'Poste "Écarts de conversion - Actif" manquant (Art. 821-1 VII)',
      'Poste "Autres fonds propres" manquant (Art. 821-1 II)',
      'Poste "Provisions" manquant (Art. 821-1 III)',
      'Poste "Écarts de conversion - Passif" manquant (Art. 821-1 V)',
      'Vérifier IR3 : Les postes vides pendant 2 exercices consécutifs peuvent être omis (Art. 811-3)',
    ])
  })

  it('flags missing sub-posts, a missing capital and negative net fixed assets', () => {
    const result = validateBalanceSheetStructure(
      balanceSheet(
        { total: 0, actifImmobilise: { incorporelles: fixed(-10), corporelles: fixed(-5) }, actifCirculant: {} },
        { total: 0, capitauxPropres: {}, provisions: {}, dettes: {} },
      ),
    )
    expect(result.errors).toEqual(['Poste "Capital" manquant dans les capitaux propres'])
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Immobilisations incorporelles : valeur nette négative (à vérifier)',
        'Immobilisations corporelles : valeur nette négative (à vérifier)',
        'Poste "Stocks et en-cours" manquant dans l\'actif circulant',
        'Poste "Créances" manquant dans l\'actif circulant',
        'Poste "Réserves" manquant dans les capitaux propres',
        'Poste "Provisions pour risques" manquant (Art. 821-1 III)',
        'Poste "Provisions pour charges" manquant (Art. 821-1 III)',
        'Poste "Dettes fournisseurs" manquant dans les dettes',
        'Poste "Dettes fiscales et sociales" manquant dans les dettes',
      ]),
    )
  })
})

describe('validateIncomeStatementStructure (PCG art. 821-2)', () => {
  it('makes missing operating posts and intermediate results errors', () => {
    const result = validateIncomeStatementStructure({ produits: {}, charges: {} })
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([
      'Poste "Produits d\'exploitation" manquant (Art. 821-2 I)',
      'Poste "Charges d\'exploitation" manquant (Art. 821-2 II)',
      'Calculs intermédiaires manquants (Art. 821-2)',
    ])
    expect(result.warnings).toEqual([
      'Poste "Produits financiers" manquant (Art. 821-2 V)',
      'Poste "Produits exceptionnels" manquant (Art. 821-2 VII)',
      'Poste "Charges financières" manquant (Art. 821-2 VI)',
      'Poste "Charges exceptionnelles" manquant (Art. 821-2 VIII)',
      'Poste "Participation des salariés" manquant (Art. 821-2 IX)',
      'Poste "Impôts sur les bénéfices" manquant (Art. 821-2 X)',
      'Vérifier IR3 : Les montants négatifs doivent être présentés entre parenthèses ou précédés du signe moins (-)',
    ])
  })

  it('names each missing intermediate result', () => {
    const statement: IncomeStatement = {
      produits: { exploitation: {}, financiers: {}, exceptionnels: {} },
      charges: { exploitation: {}, financieres: {}, exceptionnelles: {}, participationSalaries: {}, impotsBenefices: {} },
      calculs: { resultatExploitation: 0, totalProduits: 0 },
    }
    expect(validateIncomeStatementStructure(statement).errors).toEqual([
      'Résultat financier manquant (Art. 821-2)',
      'Résultat courant avant impôts manquant (Art. 821-2)',
      'Résultat exceptionnel manquant (Art. 821-2)',
      'Bénéfice ou perte manquant (Art. 821-2)',
      'Total des charges manquant (Art. 821-2)',
    ])
  })

  it('warns about every missing sub-post of the operating and financial posts (art. 821-2 IR4)', () => {
    const statement: IncomeStatement = {
      produits: { exploitation: {}, financiers: {}, exceptionnels: {} },
      charges: { exploitation: { dotations: {} }, financieres: {}, exceptionnelles: {}, participationSalaries: {}, impotsBenefices: {} },
      calculs: { resultatExploitation: 0, resultatFinancier: 0, resultatCourant: 0, resultatExceptionnel: 0, beneficeOuPerte: 0, totalProduits: 0, totalCharges: 0 },
    }
    const result = validateIncomeStatementStructure(statement)
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(30)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Poste "Montant net du chiffre d\'affaires" manquant (Art. 821-2 IR4)',
        'Poste "Différences positives de change" manquant (Art. 821-2 IR4)',
        'Poste "Dotations aux provisions" manquant (Art. 821-2 IR4)',
        'Poste "Valeurs comptables des cessions" manquant (Art. 821-2 IR4)',
        'Poste "Différences négatives de change" manquant (Art. 821-2 IR4)',
      ]),
    )
    // Without a dotations block, one warning replaces the four detailed ones.
    const withoutDotations = validateIncomeStatementStructure({ ...statement, charges: { ...statement.charges, exploitation: {} } })
    expect(withoutDotations.warnings).toContain('Poste "Dotations" manquant (Art. 821-2 IR4)')
    expect(withoutDotations.warnings).toHaveLength(27)
  })
})
