/**
 * The financial indicators as the page, the exports and the documentation
 * present them: sections of rows with their French label, the PCG accounts
 * and the lines of the official forms they come from (cerfa 2052-SD and
 * 2053-SD for the income statement, 2050-SD and 2051-SD for the balance
 * sheet, 2033-B-SD for the simplified regime). Pure: only type imports, so
 * client components can use it.
 */

import type { FinancialIndicators } from './indicators'

export type RowKind = 'amount' | 'total' | 'percent' | 'days'

export interface IndicatorRow {
  id: string
  label: string
  /** How the row enters the balance it leads to: added, subtracted or the balance itself. */
  operator?: '+' | '-' | '='
  /** PCG accounts and form lines, for the reader who checks the figure. */
  source: string
  kind: RowKind
  value: (indicators: FinancialIndicators) => number | null
}

export interface IndicatorSection {
  id: 'sig' | 'caf' | 'bilan' | 'ratios'
  title: string
  description: string
  rows: IndicatorRow[]
}

export const INDICATOR_SECTIONS: IndicatorSection[] = [
  {
    id: 'sig',
    title: 'Soldes intermédiaires de gestion',
    description:
      "Du chiffre d'affaires au résultat, étape par étape : chaque solde dit ce que l'activité a produit avant la charge suivante.",
    rows: [
      { id: 'ventesMarchandises', label: 'Ventes de marchandises', operator: '+', source: '707, 7097 (2052 FC ; 2033-B 210)', kind: 'amount', value: (i) => i.sig.ventesMarchandisesCents },
      { id: 'coutMarchandises', label: "Coût d'achat des marchandises vendues", operator: '-', source: '607, 6087, 6097, 6037 (2052 FS + FT ; 2033-B 234 + 236)', kind: 'amount', value: (i) => i.sig.coutMarchandisesCents },
      { id: 'margeCommerciale', label: 'Marge commerciale', operator: '=', source: 'Ventes moins coût des marchandises vendues', kind: 'total', value: (i) => i.sig.margeCommercialeCents },
      { id: 'productionVendue', label: 'Production vendue', operator: '+', source: '70 sauf 707 et 7097 (2052 FD à FI ; 2033-B 214 + 218)', kind: 'amount', value: (i) => i.sig.productionVendueCents },
      { id: 'productionStockee', label: 'Production stockée', operator: '+', source: '71 (2052 FM ; 2033-B 222)', kind: 'amount', value: (i) => i.sig.productionStockeeCents },
      { id: 'productionImmobilisee', label: 'Production immobilisée', operator: '+', source: '72 (2052 FN ; 2033-B 224)', kind: 'amount', value: (i) => i.sig.productionImmobiliseeCents },
      { id: 'productionExercice', label: "Production de l'exercice", operator: '=', source: 'Production vendue, stockée et immobilisée', kind: 'total', value: (i) => i.sig.productionExerciceCents },
      { id: 'consommationsTiers', label: 'Consommations en provenance de tiers', operator: '-', source: '60 sauf marchandises, 61, 62 (2052 FU + FV + FW ; 2033-B 238 + 240 + 242)', kind: 'amount', value: (i) => i.sig.consommationsTiersCents },
      { id: 'valeurAjoutee', label: 'Valeur ajoutée', operator: '=', source: 'Marge commerciale + production - consommations', kind: 'total', value: (i) => i.sig.valeurAjouteeCents },
      { id: 'subventionsExploitation', label: "Subventions d'exploitation", operator: '+', source: '74 sauf 747 (2052 FO ; 2033-B 226)', kind: 'amount', value: (i) => i.sig.subventionsExploitationCents },
      { id: 'impotsTaxes', label: 'Impôts, taxes et versements assimilés', operator: '-', source: '63 (2052 FX ; 2033-B 244)', kind: 'amount', value: (i) => i.sig.impotsTaxesCents },
      { id: 'chargesPersonnel', label: 'Charges de personnel', operator: '-', source: '64 (2052 FY + FZ ; 2033-B 250 + 252)', kind: 'amount', value: (i) => i.sig.chargesPersonnelCents },
      { id: 'ebe', label: "Excédent brut d'exploitation (EBE)", operator: '=', source: 'Valeur ajoutée + subventions - impôts et taxes - personnel', kind: 'total', value: (i) => i.sig.ebeCents },
      { id: 'reprisesTransferts', label: 'Reprises et transferts de charges', operator: '+', source: '78 sauf 786 et 787, 79 sauf 796 et 797 (2052 FP)', kind: 'amount', value: (i) => i.sig.reprisesTransfertsCents },
      { id: 'autresProduits', label: 'Autres produits', operator: '+', source: '75 sauf 755, 747 (2052 FQ, F1 ; 2033-B 230)', kind: 'amount', value: (i) => i.sig.autresProduitsCents },
      { id: 'dotationsExploitation', label: "Dotations aux amortissements, dépréciations et provisions d'exploitation", operator: '-', source: '68 sauf 686 et 687 (2052 GA à GD ; 2033-B 254 + 256)', kind: 'amount', value: (i) => i.sig.dotationsExploitationCents },
      { id: 'autresCharges', label: 'Autres charges', operator: '-', source: '65 sauf 655 (2052 GE, G1 ; 2033-B 262)', kind: 'amount', value: (i) => i.sig.autresChargesCents },
      { id: 'resultatExploitation', label: "Résultat d'exploitation", operator: '=', source: '2052 GG ; 2033-B 270', kind: 'total', value: (i) => i.sig.resultatExploitationCents },
      { id: 'quotesParts', label: 'Quotes-parts de résultat sur opérations faites en commun', operator: '+', source: '755 - 655 (2052 GH - GI)', kind: 'amount', value: (i) => i.sig.quotesPartsCommunesCents },
      { id: 'produitsFinanciers', label: 'Produits financiers', operator: '+', source: '76, 786, 796 (2052 GP ; 2033-B 280)', kind: 'amount', value: (i) => i.sig.produitsFinanciersCents },
      { id: 'chargesFinancieres', label: 'Charges financières', operator: '-', source: '66, 686 (2052 GU ; 2033-B 294)', kind: 'amount', value: (i) => i.sig.chargesFinancieresCents },
      { id: 'resultatCourant', label: 'Résultat courant avant impôts', operator: '=', source: '2052 GW', kind: 'total', value: (i) => i.sig.resultatCourantCents },
      { id: 'produitsExceptionnels', label: 'Produits exceptionnels', operator: '+', source: '77, 787, 797 (2053 HD ; 2033-B 290)', kind: 'amount', value: (i) => i.sig.produitsExceptionnelsCents },
      { id: 'chargesExceptionnelles', label: 'Charges exceptionnelles', operator: '-', source: '67, 687 (2053 HH ; 2033-B 300)', kind: 'amount', value: (i) => i.sig.chargesExceptionnellesCents },
      { id: 'resultatExceptionnel', label: 'Résultat exceptionnel', operator: '=', source: '2053 HI', kind: 'total', value: (i) => i.sig.resultatExceptionnelCents },
      { id: 'participation', label: 'Participation des salariés', operator: '-', source: '691 (2053 HJ)', kind: 'amount', value: (i) => i.sig.participationCents },
      { id: 'impotsBenefices', label: 'Impôts sur les bénéfices', operator: '-', source: '69 sauf 691 (2053 HK ; 2033-B 306)', kind: 'amount', value: (i) => i.sig.impotsBeneficesCents },
      { id: 'resultatExercice', label: "Résultat de l'exercice", operator: '=', source: '2053 HN ; 2033-B 310', kind: 'total', value: (i) => i.sig.resultatExerciceCents },
      { id: 'produitsCessions', label: "Produits des cessions d'éléments d'actif", source: '757, 7671 (775 avant le règlement ANC 2022-06)', kind: 'amount', value: (i) => i.sig.produitsCessionsCents },
      { id: 'valeurComptableCessions', label: "Valeur comptable des éléments d'actif cédés", source: '657, 6671 (675 avant le règlement ANC 2022-06)', kind: 'amount', value: (i) => i.sig.valeurComptableCessionsCents },
      { id: 'plusValuesCession', label: 'Plus ou moins-values de cession', operator: '=', source: 'Produits des cessions - valeur comptable, déjà compris dans les soldes ci-dessus', kind: 'total', value: (i) => i.sig.plusValuesCessionCents },
    ],
  },
  {
    id: 'caf',
    title: "Capacité d'autofinancement",
    description:
      "Ce que l'exercice laisse à la société pour investir, rembourser ou distribuer : le résultat sans les produits et charges calculés.",
    rows: [
      { id: 'cafResultat', label: "Résultat de l'exercice", operator: '+', source: '2053 HN', kind: 'amount', value: (i) => i.caf.resultatExerciceCents },
      { id: 'cafDotations', label: 'Dotations aux amortissements, dépréciations et provisions', operator: '+', source: '681, 686, 687', kind: 'amount', value: (i) => i.caf.dotationsCents },
      { id: 'cafReprises', label: 'Reprises sur amortissements, dépréciations et provisions', operator: '-', source: '781, 786, 787', kind: 'amount', value: (i) => i.caf.reprisesCents },
      { id: 'cafValeurComptable', label: "Valeur comptable des éléments d'actif cédés", operator: '+', source: '657, 6671, 675', kind: 'amount', value: (i) => i.caf.valeurComptableCessionsCents },
      { id: 'cafProduitsCessions', label: "Produits des cessions d'éléments d'actif", operator: '-', source: '757, 7671, 775', kind: 'amount', value: (i) => i.caf.produitsCessionsCents },
      { id: 'cafSubventions', label: "Quote-part des subventions d'investissement virée au résultat", operator: '-', source: '747 (777 avant le règlement ANC 2022-06)', kind: 'amount', value: (i) => i.caf.quotePartSubventionsCents },
      { id: 'caf', label: "Capacité d'autofinancement (CAF)", operator: '=', source: 'Méthode additive, égale à la méthode soustractive depuis l\'EBE', kind: 'total', value: (i) => i.caf.cafCents },
    ],
  },
  {
    id: 'bilan',
    title: 'Besoin en fonds de roulement et trésorerie',
    description:
      "Lus au bilan de l'exercice : ce que le cycle d'exploitation immobilise, la trésorerie disponible et l'endettement.",
    rows: [
      { id: 'stocks', label: 'Stocks et en-cours', operator: '+', source: '31 à 38 nets des dépréciations 39 (2050 BL à BT)', kind: 'amount', value: (i) => i.bilan.stocksCents },
      { id: 'creancesClients', label: 'Créances clients', operator: '+', source: '41 débiteurs nets de 491 (2050 BX)', kind: 'amount', value: (i) => i.bilan.creancesClientsCents },
      { id: 'autresCreances', label: "Autres créances d'exploitation", operator: '+', source: '4091 (2050 BV) ; 40, 42, 43, 44 débiteurs (part de 2050 BZ)', kind: 'amount', value: (i) => i.bilan.autresCreancesExploitationCents },
      { id: 'dettesFournisseurs', label: 'Dettes fournisseurs', operator: '-', source: '401, 403, 4081, 4088 créditeurs (2051 DX)', kind: 'amount', value: (i) => i.bilan.dettesFournisseursCents },
      { id: 'dettesFiscalesSociales', label: 'Dettes fiscales et sociales', operator: '-', source: '42, 43, 44 créditeurs (2051 DY)', kind: 'amount', value: (i) => i.bilan.dettesFiscalesSocialesCents },
      { id: 'bfr', label: 'Besoin en fonds de roulement (BFR)', operator: '=', source: 'Stocks + créances - dettes fournisseurs, fiscales et sociales', kind: 'total', value: (i) => i.bilan.bfrCents },
      { id: 'valeursMobilieres', label: 'Valeurs mobilières de placement', operator: '+', source: '50 net de 59 (2050 CD)', kind: 'amount', value: (i) => i.bilan.valeursMobilieresCents },
      { id: 'disponibilites', label: 'Disponibilités', operator: '+', source: '51, 53, 54 débiteurs (2050 CF)', kind: 'amount', value: (i) => i.bilan.disponibilitesCents },
      { id: 'concoursBancaires', label: 'Concours bancaires courants', operator: '-', source: '51 créditeurs (part de 2051 DU)', kind: 'amount', value: (i) => i.bilan.concoursBancairesCents },
      { id: 'tresorerieNette', label: 'Trésorerie nette', operator: '=', source: 'Placements + disponibilités - découverts', kind: 'total', value: (i) => i.bilan.tresorerieNetteCents },
      { id: 'dettesFinancieres', label: 'Dettes financières', source: '16, 17 et emprunts bancaires hors découverts (2051 DS, DT, DU, DV)', kind: 'amount', value: (i) => i.bilan.dettesFinancieresCents },
      { id: 'capitauxPropres', label: 'Capitaux propres', source: "Comptes 10 à 14 et résultat de l'exercice (2051 DL)", kind: 'amount', value: (i) => i.bilan.capitauxPropresCents },
    ],
  },
  {
    id: 'ratios',
    title: 'Ratios et délais',
    description: 'Rentabilité, délais de paiement et endettement, calculés sur les montants ci-dessus.',
    rows: [
      { id: 'tauxMarge', label: 'Taux de marge', source: 'Marge commerciale / coût d\'achat des marchandises vendues', kind: 'percent', value: (i) => i.ratios.tauxMarge },
      { id: 'tauxMarque', label: 'Taux de marque', source: 'Marge commerciale / ventes de marchandises', kind: 'percent', value: (i) => i.ratios.tauxMarque },
      { id: 'margeEbe', label: "EBE / chiffre d'affaires", source: "EBE / comptes 70", kind: 'percent', value: (i) => i.ratios.margeEbe },
      { id: 'margeNette', label: "Résultat / chiffre d'affaires", source: "Résultat de l'exercice / comptes 70", kind: 'percent', value: (i) => i.ratios.margeNette },
      { id: 'dso', label: 'Délai de paiement des clients (DSO)', source: "Créances clients brutes TTC / (chiffre d'affaires HT + TVA collectée 4457) x jours", kind: 'days', value: (i) => i.delais.dsoDays },
      { id: 'dpo', label: 'Délai de paiement des fournisseurs (DPO)', source: 'Dettes fournisseurs TTC / (achats et charges externes HT + TVA déductible 44566) x jours', kind: 'days', value: (i) => i.delais.dpoDays },
      { id: 'endettement', label: "Ratio d'endettement", source: 'Dettes financières / capitaux propres', kind: 'percent', value: (i) => i.ratios.endettement },
    ],
  },
]
