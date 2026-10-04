/**
 * The lines of the two VAT return forms Kledg prepares, with the box codes
 * printed next to them (the codes the online form and the EDI file use).
 * Pure data, checked against the 2026 forms and their notices:
 * - 3310-CA3-SD, cerfa n° 10963*31, notice 3310-NOT-CA3-SD n° 50449#29
 *   (réel normal and mini réel);
 * - 3517-S-SD CA12, cerfa n° 11417*27, notice 3517-S-NOT-SD n° 51306#18
 *   (réel simplifié).
 * Rules of liquidation: BOI-TVA-DECLA-20-20 (declaration and payment),
 * BOI-TVA-DECLA-20-20-20-10 (content of the returns), BOI-TVA-DECLA-20-20-30-10
 * (régime simplifié).
 */

import type { VatForm } from './periods'

export interface VatSource {
  label: string
  url: string
}

export const VAT_SOURCES = {
  ca3Form: {
    label: 'Formulaire 3310-CA3-SD (cerfa n° 10963*31)',
    url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/3310-ca3-sd/2026/3310-ca3-sd_5377.pdf',
  },
  ca3Notice: {
    label: 'Notice 3310-NOT-CA3-SD (n° 50449#29)',
    url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/3310-ca3-sd/2026/3310-ca3-sd_5426.pdf',
  },
  ca12Form: {
    label: 'Formulaire 3517-S-SD CA12 (cerfa n° 11417*27)',
    url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/3517-s-sd/2026/3517-s-sd_5291.pdf',
  },
  ca12Notice: {
    label: 'Notice 3517-S-NOT-SD (n° 51306#18)',
    url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/3517-s-sd/2026/3517-s-sd_5424.pdf',
  },
  bofipDecla: {
    label: 'BOI-TVA-DECLA-20-20 (déclaration des opérations et paiement de la taxe)',
    url: 'https://bofip.impots.gouv.fr/bofip/911-PGP.html/identifiant=BOI-TVA-DECLA-20-20-20220216',
  },
  bofipContent: {
    label: 'BOI-TVA-DECLA-20-20-20-10 (contenu des déclarations)',
    url: 'https://bofip.impots.gouv.fr/bofip/2883-PGP.html/identifiant=BOI-TVA-DECLA-20-20-20-10-20150603',
  },
  bofipSimplified: {
    label: 'BOI-TVA-DECLA-20-20-30-10 (régime simplifié)',
    url: 'https://bofip.impots.gouv.fr/bofip/2418-PGP.html/identifiant=BOI-TVA-DECLA-20-20-30-10-20230118',
  },
  cgi287: { label: 'CGI, art. 287', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048826856' },
  cgi293B: { label: 'CGI, art. 293 B (franchise en base)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045035275' },
  bofipFranchise: {
    label: 'BOI-TVA-DECLA-40 (franchise en base)',
    url: 'https://bofip.impots.gouv.fr/bofip/218-PGP.html/identifiant=BOI-TVA-DECLA-40-20170705',
  },
  pcg944: { label: 'PCG, art. 944-44 (comptes de taxes sur le chiffre d’affaires)', url: 'https://www.anc.gouv.fr/normes-comptables-francaises/reglements-de-lanc' },
} as const satisfies Record<string, VatSource>

export interface FormLineDef {
  code: string
  /** Box code of the form (0207...), null for a total the form computes. */
  box: string | null
  label: string
  /** 'base-tax': base and tax columns; 'base': a base only; 'amount': one amount. */
  columns: 'base-tax' | 'base' | 'amount'
}

const line = (code: string, box: string | null, label: string, columns: FormLineDef['columns']): FormLineDef => ({ code, box, label, columns })

/** CA3 lines Kledg fills or lists, in the order of the form. */
export const CA3_LINES = {
  A1: line('A1', '0979', 'Ventes, prestations de services', 'base'),
  A2: line('A2', '0981', 'Autres opérations imposables', 'base'),
  A3: line('A3', '0044', 'Achats de prestations de services réalisés auprès d’un assujetti non établi en France (article 283-2 du CGI)', 'base'),
  B2: line('B2', '0031', 'Acquisitions intracommunautaires', 'base'),
  B4: line('B4', '0040', 'Achats de biens ou de prestations de services réalisés auprès d’un assujetti non établi en France (article 283-1 du CGI)', 'base'),
  B5: line('B5', '0036', 'Régularisations', 'base'),
  E1: line('E1', '0032', 'Exportations hors UE', 'base'),
  E2: line('E2', '0033', 'Autres opérations non imposables', 'base'),
  F2: line('F2', '0034', 'Livraisons intracommunautaires à destination d’une personne assujettie, ventes B to B', 'base'),
  L08: line('08', '0207', 'Taux normal 20 %', 'base-tax'),
  L09: line('09', '0105', 'Taux réduit 5,5 %', 'base-tax'),
  L9B: line('9B', '0151', 'Taux réduit 10 %', 'base-tax'),
  T6: line('T6', '1010', 'Opérations réalisées en France continentale au taux de 2,1 %', 'base-tax'),
  L15: line('15', '0600', 'TVA antérieurement déduite à reverser', 'amount'),
  L5B: line('5B', '0602', 'Sommes à ajouter, y compris acompte congés', 'amount'),
  L16: line('16', null, 'Total de la TVA brute due (lignes 08 à 5B)', 'amount'),
  L17: line('17', '0035', 'Dont TVA sur acquisitions intracommunautaires', 'amount'),
  L19: line('19', '0703', 'Biens constituant des immobilisations', 'amount'),
  L20: line('20', '0702', 'Autres biens et services', 'amount'),
  L21: line('21', '0059', 'Autre TVA à déduire', 'amount'),
  L22: line('22', '8001', 'Report du crédit apparaissant ligne 27 de la précédente déclaration', 'amount'),
  L2C: line('2C', '0603', 'Sommes à imputer, y compris acompte congés', 'amount'),
  L23: line('23', null, 'Total TVA déductible (lignes 19 à 2C)', 'amount'),
  L25: line('25', '0705', 'Crédit de TVA (ligne 23 - ligne 16)', 'amount'),
  TD: line('TD', '8900', 'TVA due (ligne 16 - ligne 23)', 'amount'),
  L26: line('26', '8002', 'Remboursement de crédit de TVA demandé sur formulaire n° 3519', 'amount'),
  L27: line('27', '8003', 'Crédit de TVA à reporter (ligne 25 - ligne 26)', 'amount'),
  L28: line('28', '8901', 'TVA nette due (ligne TD - ligne X5)', 'amount'),
  L29: line('29', '9979', 'Taxes assimilées calculées sur l’annexe n° 3310 A', 'amount'),
  L32: line('32', '9992', 'Total à payer (lignes 28 + 29 + Z5 - AB)', 'amount'),
} as const

/** CA12 lines Kledg fills or lists, in the order of the form. */
export const CA12_LINES = {
  L02: line('02', '0032', 'Exportations hors UE', 'base'),
  L03: line('03', '0033', 'Autres opérations non imposables', 'base'),
  L04: line('04', '0034', 'Livraisons intracommunautaires à destination d’une personne assujettie', 'base'),
  L5A: line('5A', '0207', 'Taux normal 20 %', 'base-tax'),
  L06: line('06', '0105', 'Taux réduit 5,5 %', 'base-tax'),
  L6C: line('6C', '0151', 'Taux réduit 10 %', 'base-tax'),
  L09: line('09', '0950', 'Opérations imposables à un taux particulier', 'base-tax'),
  AC: line('AC', '0044', 'Achats de prestations de services auprès d’un assujetti non établi en France (article 283-2 du CGI)', 'base-tax'),
  L11: line('11', '0970', 'Cessions d’immobilisations', 'base-tax'),
  L12: line('12', '0980', 'Livraisons à soi-même', 'base-tax'),
  L16: line('16', null, 'Total de la taxe due (lignes 5A à 13)', 'amount'),
  L17: line('17', '0983', 'Remboursements provisionnels obtenus en cours d’année ou d’exercice', 'amount'),
  L18: line('18', '0600', 'TVA antérieurement déduite à reverser', 'amount'),
  AD: line('AD', '0602', 'Sommes à ajouter', 'amount'),
  L19: line('19', null, 'Total de la TVA brute due (lignes 16 + 17 + 18 + AD)', 'amount'),
  L20: line('20', '0702', 'Déductions sur factures', 'amount'),
  L21: line('21', '0704', 'Déductions forfaitaires', 'amount'),
  L22: line('22', null, 'Total (lignes 20 + 21)', 'amount'),
  L23: line('23', '0703', 'TVA déductible sur immobilisations', 'amount'),
  L24: line('24', '0058', 'Crédit antérieur non imputé et non remboursé', 'amount'),
  L25: line('25', '0059', 'Omissions ou compléments de déductions', 'amount'),
  AE: line('AE', '0603', 'Sommes à imputer', 'amount'),
  L26: line('26', null, 'Total de la TVA déductible (lignes 22 + 23 + 24 + 25 + AE)', 'amount'),
  L28: line('28', '8900', 'TVA due (ligne 19 - ligne 26)', 'amount'),
  L29: line('29', '0705', 'Crédit (ligne 26 - ligne 19)', 'amount'),
  L30: line('30', '0018', 'Acomptes payés et / ou restant dus', 'amount'),
  L33: line('33', null, 'Solde dû (ligne 28 - lignes 29 et 30)', 'amount'),
  L34: line('34', null, 'Excédent de versement (ligne 30 - ligne 28)', 'amount'),
  L35: line('35', '0020', 'Solde excédentaire (lignes 29 + 34)', 'amount'),
  L55: line('55', null, 'Taxes assimilées (total lignes 36 à 94)', 'amount'),
  L56: line('56', '9992', 'Total à payer (lignes 54 + 55 + Z5)', 'amount'),
  L57: line('57', null, 'Base de calcul des acomptes dus au titre de l’exercice suivant : TVA [ligne 16 - (lignes 11 + 12 + 22)]', 'amount'),
} as const

/** The rate lines of each form, by rate in basis points. */
export const RATE_LINES: Record<VatForm, Record<number, FormLineDef>> = {
  CA3: { 2000: CA3_LINES.L08, 1000: CA3_LINES.L9B, 550: CA3_LINES.L09, 210: CA3_LINES.T6 },
  CA12: { 2000: CA12_LINES.L5A, 1000: CA12_LINES.L6C, 550: CA12_LINES.L06, 210: CA12_LINES.L09 },
}

export const FORM_TITLES: Record<VatForm, string> = {
  CA3: 'Déclaration 3310-CA3-SD (régime réel normal)',
  CA12: 'Déclaration annuelle 3517-S-SD CA12 (régime simplifié)',
}

/**
 * What Kledg cannot know from the books, the same for every period of a
 * form: shown with the worksheet so the user completes the return.
 */
export const NOT_FROM_THE_BOOKS: Record<VatForm, string[]> = {
  CA3: [
    'Les opérations qui ne sont pas comptabilisées dans Kledg, ou comptabilisées après la préparation.',
    'La ventilation des ventes sans TVA entre exportations (E1), livraisons intracommunautaires (F2) et autres opérations non imposables (E2) : Kledg les place en E2.',
    'Les autres opérations imposables de la ligne A2 (cessions d’immobilisations, livraisons à soi-même, sous-traitance du BTP en autoliquidation) : Kledg les compte en A1.',
    'Les achats auprès d’un assujetti non établi en France de l’article 283-1 (ligne B4) et les importations (A4, I1 à I6) : Kledg ne les distingue pas.',
    'Les régimes particuliers : TVA sur la marge (biens d’occasion, agences de voyage, terrains à bâtir), opérations dans les DOM ou en Corse, produits pétroliers, droits d’auteur, anciens taux.',
    'Le coefficient de déduction des assujettis partiels (ligne 22A) et les déductions limitées (véhicules de tourisme, logement) : Kledg reprend la TVA comptabilisée en 4456.',
    'Les taxes assimilées de l’annexe 3310 A (ligne 29), l’accise sur les énergies (lignes X à Z), les régularisations des lignes 5B et 2C, la demande de remboursement (ligne 26).',
  ],
  CA12: [
    'Les opérations qui ne sont pas comptabilisées dans Kledg, ou comptabilisées après la préparation.',
    'La ventilation des ventes sans TVA entre exportations (02), livraisons intracommunautaires (04) et autres opérations non imposables (03) : Kledg les place en 03.',
    'Les cessions d’immobilisations (ligne 11) et les livraisons à soi-même (ligne 12) : Kledg les compte avec les ventes au taux correspondant.',
    'Les achats auprès d’un assujetti non établi en France de l’article 283-1 (ligne AB) : Kledg ne les distingue pas des acquisitions intracommunautaires, placées sur les lignes de taux.',
    'Les régimes particuliers : TVA sur la marge, opérations dans les DOM ou en Corse, produits pétroliers, anciens taux.',
    'La déduction forfaitaire (ligne 21), le coefficient de déduction (ligne 25A) et les déductions limitées : Kledg reprend la TVA comptabilisée en 4456.',
    'Les remboursements provisionnels (ligne 17), les sommes des lignes AD et AE, les taxes assimilées (lignes 36 à 94), l’accise sur les énergies, la demande de remboursement (cadre VII).',
    'Les acomptes restant dus (colonne 2 de la ligne 30) : Kledg reprend les acomptes payés, comptabilisés au compte 44581.',
  ],
}
