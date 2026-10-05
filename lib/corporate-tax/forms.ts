/**
 * Forms of the impôt sur les sociétés and what stays to fill by hand
 * (docs/impot-societes.md). Pure data.
 *
 * - Régime simplifié: déclaration 2065-SD with the liasse 2033-SD, the
 *   tax result on the 2033-B-SD (lines 312 to 372, 2026 form);
 * - régime normal: 2065-SD with the liasse 2050, the tax result on the
 *   2058-A-SD (lines WA to XO, 2026 form);
 * - acomptes on the relevé 2571-SD, balance on the relevé 2572-SD.
 */

import type { CorporateTaxRegime } from './compute'
import { CORPORATE_TAX_SOURCES, type CorporateTaxSource } from './sources'

export const FORM_TITLES: Record<CorporateTaxRegime, string> = {
  simplified: 'Déclaration 2065-SD et tableau 2033-B-SD (régime simplifié)',
  normal: 'Déclaration 2065-SD et tableau 2058-A-SD (régime réel normal)',
}

/** What Kledg cannot read in the books: listed with every worksheet (page, PDF, CSV, MCP tool). */
export const NOT_FROM_THE_BOOKS: readonly string[] = [
  'Les opérations qui ne sont pas comptabilisées dans Kledg, et les écritures validées après la préparation.',
  'Dépenses somptuaires (chasse, pêche, yachts, résidences de plaisance) et charges non déductibles de l’article 39, 4 du CGI, dont le montant est soumis à l’approbation des associés (art. 223 quater).',
  'Amortissements excédentaires des voitures particulières au-delà du plafond de l’article 39, 4 (il dépend du taux de CO2 du véhicule).',
  'Avantages personnels non déductibles, rémunérations excessives, cadeaux au-delà des limites admises.',
  'Provisions non déductibles (tableau 2033-D ou 2058-B) et leurs reprises déjà taxées.',
  'Intérêts excédentaires des comptes courants d’associés (CGI, art. 39, 1, 3° et 212).',
  'Plus-values et moins-values à long terme, plus-values à taux réduit et quote-part de 12 % des plus-values de cession de titres de participation.',
  'Dividendes d’une participation que les associés enregistrés ne montrent pas, ou détenue entre 2,5 % et 5 % du capital avec 5 % des droits de vote (CGI, art. 145).',
  'Réductions et crédits d’impôt : recherche, innovation, mécénat, famille, apprentissage... à ajouter comme lignes de crédit d’impôt.',
  'Report en arrière d’un déficit (CGI, art. 220 quinquies, formulaire 2039-SD), régimes d’exonération (zones, jeunes entreprises innovantes), intégration fiscale.',
  'Acomptes de la contribution sociale (CGI, art. 1668 D) et cinquième acompte des sociétés dont le chiffre d’affaires dépasse 250 M€.',
]

export function sourcesFor(regime: CorporateTaxRegime): CorporateTaxSource[] {
  const s = CORPORATE_TAX_SOURCES
  return [
    regime === 'simplified' ? s.form2033 : s.form2050,
    s.form2065,
    s.form2571,
    s.form2572,
    s.cgi219,
    s.bofipLiqRate,
    s.cgi209,
    s.bofipDeficits,
    s.cgi213,
    s.cgi39,
    s.cgi145,
    s.cgi216,
    s.bofipParent,
    s.cgi235terZC,
    s.cgi1668,
    s.bofipAcomptes,
    s.bofipNewCompanies,
  ]
}
