/**
 * The tables of the liasse fiscale of each regime (pure data, usable by the
 * client), with where Kledg prepares them:
 * - here: on the Liasse fiscale page (lib/liasse);
 * - page: on another page of Kledg (balance sheet, income statement,
 *   impôt sur les sociétés, fixed assets), linked;
 * - manual: not prepared by Kledg, to fill by hand.
 *
 * Régime simplifié (CGI art. 302 septies A bis): declaration 2065-SD with
 * the tables 2033-A-SD to 2033-G-SD (liasse 2033-SD 2026, notice
 * 2033-NOT-SD). Régime réel normal (CGI art. 53 A): 2065-SD with the tables
 * 2050-SD to 2059-G-SD (liasse 2050 2026, notice 2032-NOT-SD).
 *
 * Kledg prepares the liasse; it does not file it. The declaration is filed
 * online (CGI art. 1649 quater B quater), through the professional space on
 * impots.gouv.fr (EFI mode, typed in) or through an EDI partner approved by
 * the DGFiP (EDI-TDFC): the figures are copied from Kledg's page or exports.
 */

import type { CorporateTaxRegime } from '@/lib/corporate-tax/compute'

export type TableStatus = 'here' | 'page' | 'manual'

export interface LiasseTableDef {
  id: string
  number: string
  title: string
  status: TableStatus
  /** Company-relative URL of the page that prepares it (status page). */
  href: string | null
  note: string | null
}

const t = (id: string, number: string, title: string, status: TableStatus, href: string | null = null, note: string | null = null): LiasseTableDef => ({ id, number, title, status, href, note })

const COVER = t('2065', '2065-SD', 'Déclaration de résultat (impôt sur les sociétés) et annexe 2065 bis-SD', 'here')

export const LIASSE_TABLES: Record<CorporateTaxRegime, readonly LiasseTableDef[]> = {
  simplified: [
    COVER,
    t('2033-A', '2033-A-SD', 'Bilan simplifié', 'page', '/reports/balance-sheet', 'Présentation simplifiée du bilan, cases 010 à 180.'),
    t('2033-B', '2033-B-SD', 'Compte de résultat simplifié de l\'exercice', 'page', '/reports/income-statement', 'Cadre A (résultat comptable) : compte de résultat en présentation simplifiée.'),
    t('2033-B-fiscal', '2033-B-SD', 'Compte de résultat simplifié : cadre B, résultat fiscal', 'page', '/impot-societes', 'Lignes 310 à 372 : réintégrations, déductions et déficits.'),
    t('2033-C', '2033-C-SD', 'Immobilisations, amortissements, plus-values, moins-values', 'page', '/reports/fixed-asset-movements', 'Cadres I et II ; le cadre III (plus et moins-values) reste à remplir à la main.'),
    t('2033-D', '2033-D-SD', 'Relevé des provisions, amortissements dérogatoires, déficits reportables, divers', 'here'),
    t('2033-E', '2033-E-SD', 'Détermination des effectifs et de la valeur ajoutée', 'here'),
    t('2033-F', '2033-F-SD', 'Composition du capital social', 'here'),
    t('2033-G', '2033-G-SD', 'Filiales et participations', 'here'),
  ],
  normal: [
    COVER,
    t('2050', '2050-SD', 'Bilan : actif', 'page', '/reports/balance-sheet', 'Présentation complète du bilan.'),
    t('2051', '2051-SD', 'Bilan : passif avant répartition', 'page', '/reports/balance-sheet', 'Présentation complète du bilan.'),
    t('2052', '2052-SD', 'Compte de résultat de l\'exercice (en liste)', 'page', '/reports/income-statement', 'Présentation complète.'),
    t('2053', '2053-SD', 'Compte de résultat de l\'exercice (suite)', 'page', '/reports/income-statement', 'Présentation complète.'),
    t('2054', '2054-SD', 'Immobilisations', 'page', '/reports/fixed-asset-movements', "La colonne de la valeur d'origine des immobilisations réévaluées reste à remplir à la main."),
    t('2054-bis', '2054 bis-SD', 'Tableau des écarts de réévaluation sur immobilisations amortissables', 'manual', null, 'Seulement après une réévaluation légale : Kledg ne la suit pas.'),
    t('2055', '2055-SD', 'Amortissements', 'page', '/reports/fixed-asset-movements', 'Cadre A ; les amortissements dérogatoires (cadre B) restent à remplir à la main.'),
    t('2056', '2056-SD', 'Provisions inscrites au bilan', 'manual', null, 'À remplir à la main.'),
    t('2057', '2057-SD', 'État des échéances des créances et des dettes à la clôture de l\'exercice', 'manual', null, 'À remplir à la main.'),
    t('2058-A', '2058-A-SD', 'Détermination du résultat fiscal', 'page', '/impot-societes', 'Lignes WA à XO.'),
    t('2058-B', '2058-B-SD', 'Déficits, indemnités pour congés à payer et provisions non déductibles', 'manual', null, 'À remplir à la main.'),
    t('2058-C', '2058-C-SD', 'Tableau d\'affectation du résultat et renseignements divers', 'manual', null, 'À remplir à la main.'),
    t('2059-A', '2059-A-SD', 'Détermination des plus et moins-values', 'manual', null, 'Kledg ne calcule pas les plus et moins-values de cession : à remplir à la main.'),
    t('2059-B', '2059-B-SD', 'Affectation des plus-values à court terme et des plus-values de fusion ou d\'apport', 'manual', null, 'À remplir à la main.'),
    t('2059-C', '2059-C-SD', 'Suivi des moins-values à long terme', 'manual', null, 'À remplir à la main.'),
    t('2059-D', '2059-D-SD', 'Réserve spéciale des plus-values à long terme', 'manual', null, 'À remplir à la main.'),
    t('2059-E', '2059-E-SD', 'Détermination des effectifs et de la valeur ajoutée', 'manual', null, 'À remplir à la main.'),
    t('2059-F', '2059-F-SD', 'Composition du capital social', 'manual', null, 'À remplir à la main.'),
    t('2059-G', '2059-G-SD', 'Filiales et participations', 'manual', null, 'À remplir à la main.'),
  ],
}

export interface LiasseSource {
  label: string
  url: string
}

/** Official forms and notices, 2026 editions, as published on impots.gouv.fr. */
export const LIASSE_SOURCES = {
  form2065: { label: 'Formulaire n° 2065-SD 2026 et annexe 2065 bis-SD, avec leur notice', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/2065-sd/2026/2065-sd_5381.pdf' },
  form2033: { label: 'Liasse n° 2033-SD 2026, tableaux 2033-A-SD à 2033-G-SD', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/2033-sd/2026/2033-sd_5394.pdf' },
  notice2033: { label: 'Notice n° 2033-NOT-SD 2026', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/2033-sd/2026/2033-sd_5395.pdf' },
  form2050: { label: 'Liasse n° 2050 2026, tableaux 2050-SD à 2059-G-SD', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/2050-liasse/2026/2050-liasse_5320.pdf' },
  notice2032: { label: 'Notice n° 2032-NOT-SD 2026', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/2032-not-sd/2026/2032-not-sd_5323.pdf' },
} as const satisfies Record<string, LiasseSource>

export function liasseSources(regime: CorporateTaxRegime): LiasseSource[] {
  const s = LIASSE_SOURCES
  return regime === 'simplified' ? [s.form2065, s.form2033, s.notice2033] : [s.form2065, s.form2050, s.notice2032]
}

/** How the liasse is filed: Kledg prepares, the user or an EDI partner files. */
export const FILING_NOTE =
  "Kledg prépare la liasse, il ne la dépose pas : la déclaration se dépose par voie électronique, en recopiant les montants dans l'espace professionnel sur impots.gouv.fr (mode EFI) ou en les transmettant à un partenaire EDI agréé par la DGFiP (EDI-TDFC)."
