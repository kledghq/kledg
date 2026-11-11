/**
 * Form 2033-D-SD 2026, "Relevé des provisions, amortissements dérogatoires,
 * déficits reportables, divers" (régime simplifié, CGI art. 302 septies A
 * bis), on plain values (pure):
 * - cadre I: provisions.ts;
 * - cadre II: deficits.ts, from the impôt sur les sociétés worksheet;
 * - cadre III, divers: the VAT collected (374) and the VAT deductible on
 *   goods and services other than fixed assets (378) of the year, read in
 *   the books (vat.ts); the other lines (cotisations facultatives of the
 *   exploitant, prélèvements personnels, aides of art. 238 bis and 217
 *   octies) are not in the books;
 * - cadre IV, travailleurs indépendants (690 to 693): the revenu brut social
 *   of the notice 2033-NOT-SD, never computed by Kledg.
 */

import { amount, cell, field, manual, type LiasseForm } from './cells'
import { DEFICIT_CODES_2033D, deficitsSection, type DeficitsInput } from './deficits'
import { provisions2033D, type ProvisionsInput } from './provisions'
import type { VatTotals } from './vat'

export interface Form2033DInput {
  provisions: ProvisionsInput
  /** Null when there is no impôt sur les sociétés worksheet. */
  deficits: DeficitsInput | null
  /** Why the deficits are not computed, shown on the cells to fill. */
  deficitsWhy: string
  vat: VatTotals
}

export function buildForm2033D(input: Form2033DInput): LiasseForm {
  const provisions = provisions2033D(input.provisions)
  const deficits = deficitsSection('deficits', 'II. Déficits reportables', DEFICIT_CODES_2033D, input.deficits, input.deficitsWhy)

  const divers = [
    manual('381', 'Primes et cotisations complémentaires facultatives', "Cotisations facultatives de l'exploitant ou du gérant (article 154 bis du CGI) : elles ne se distinguent pas dans les comptes."),
    manual('325', 'Dont montant déductible des cotisations facultatives Madelin (I de l’art. 154 bis du CGI)', 'Voir la case 381.'),
    manual('327', "Dont cotisations facultatives aux nouveaux plans d'épargne retraite", 'Voir la case 381.'),
    cell('374', 'Montant de la TVA collectée', amount(input.vat.collectedCents), 'books', { accounts: input.vat.collectedAccounts, note: input.vat.note }),
    cell('378', 'Montant de la TVA déductible sur biens et services (sauf immobilisations)', amount(input.vat.deductibleCents), 'books', { accounts: input.vat.deductibleAccounts, note: input.vat.note }),
    manual('399', "Montant des prélèvements personnels de l'exploitant", "Prélèvements de marchandises ou de services par l'exploitant ou le dirigeant, au coût réel ou au prix normal de facturation (notice 2033-NOT-SD) : Kledg ne les distingue pas."),
    manual('398', "Aides perçues ayant donné droit à la réduction d'impôt prévue au 4 de l'article 238 bis du CGI pour l'entreprise donatrice", 'Mécénat reçu : à indiquer par la société bénéficiaire.'),
    manual('397', "Montant de l'investissement reçu qui a donné lieu à amortissement exceptionnel chez l'entreprise investisseur dans le cadre de l'article 217 octies du CGI", "Information détenue par l'investisseur."),
  ]
  const independents = [
    manual('690', 'Sommes à réintégrer pour la détermination du revenu brut social', 'Revenu brut social des travailleurs indépendants (notice 2033-NOT-SD, cases 690 à 693) : Kledg ne le calcule pas.'),
    manual('691', 'Sommes à déduire pour la détermination du revenu brut social', 'Voir la case 690.'),
    manual('692', 'Revenu brut social (si le montant est négatif)', 'Voir la case 690.'),
    manual('693', 'Revenu brut social (si le montant est positif)', 'Voir la case 690.'),
  ]
  return {
    id: '2033-D',
    number: '2033-D-SD',
    title: 'Relevé des provisions, amortissements dérogatoires, déficits reportables, divers',
    sections: [
      ...provisions.sections,
      deficits,
      { id: 'divers', title: 'III. Divers', columns: null, rows: divers.map((c, i) => field(`divers-${i}`, c)) },
      { id: 'independents', title: 'IV. Travailleurs indépendants', columns: null, rows: independents.map((c, i) => field(`independents-${i}`, c)) },
    ],
    checks: provisions.checks,
    warnings: [
      ...provisions.warnings,
      ...(provisions.nonDeductibleCents > 0
        ? [`La case 780 se reporte ligne 322 du 2033-B-SD : ajoutez ce montant en réintégration (« Provisions non déductibles ») sur la page Impôt sur les sociétés s'il n'y est pas.`]
        : []),
    ],
    required: { value: true, reason: null },
  }
}
