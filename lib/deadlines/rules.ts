/**
 * The rules of the deadline calendar, each with the official texts it comes
 * from. Verified on 4 October 2026 against Legifrance, BOFiP and the
 * impots.gouv.fr professional calendar (2026 pages). Pure data.
 *
 * Postponement (weekends and public holidays): BOFiP states it tax by tax.
 * VAT: a deadline falling on a public holiday "est reportée au premier jour
 * ouvrable suivant" (BOI-TVA-DECLA-20-20-10-10 §220); CFE acompte: moved to
 * the next working day (BOI-REC-PRO-20-10 §30). The impots.gouv.fr calendar
 * moves the IS dates the same way (2026: acompte of 15 March shown on
 * 16 March, solde of 15 November on 16 November). The engine postpones
 * these; legal deadlines (approval and filing of the accounts) are kept as
 * written, the cautious reading.
 *
 * From 1 January 2027 the VAT articles of the CGI move to the Code des
 * impositions sur les biens et services (ordonnance n° 2025-1247); the
 * rules below cite the CGI articles in force when they were written.
 */

import type { DeadlineRule } from './types'

const LEGIFRANCE = 'https://www.legifrance.gouv.fr/codes/article_lc/'
const LEGIFRANCE_SECTION = 'https://www.legifrance.gouv.fr/codes/section_lc/'
const BOFIP = 'https://bofip.impots.gouv.fr/bofip/'

const CGI_287 = { label: 'CGI, art. 287', url: `${LEGIFRANCE}LEGIARTI000048826856` }
const CGI_ANN4_39 = { label: 'CGI, annexe IV, art. 39', url: `${LEGIFRANCE}LEGIARTI000030190488` }
const BOI_TVA_DATES = {
  label: 'BOI-TVA-DECLA-20-20-10-10 (dates de dépôt)',
  url: `${BOFIP}1001-PGP.html/identifiant=BOI-TVA-DECLA-20-20-10-10-20230118`,
}
const BOI_TVA_RSI = {
  label: 'BOI-TVA-DECLA-20-20-30-10 (régime simplifié)',
  url: `${BOFIP}2418-PGP.html/identifiant=BOI-TVA-DECLA-20-20-30-10-20230118`,
}
const RSI_ABOLISHED = {
  label: 'impots.gouv.fr : suppression du régime simplifié de TVA au 1er janvier 2027',
  url: 'https://www.impots.gouv.fr/actualite/le-regime-simplifie-dimposition-la-tva-est-supprime-compter-du-1er-janvier-2027',
}
const CGI_1668 = { label: 'CGI, art. 1668', url: `${LEGIFRANCE}LEGIARTI000033836779` }
const BOI_IS_ACOMPTES = { label: 'BOI-IS-DECLA-20-10 (acomptes et solde)', url: `${BOFIP}3558-PGP.html` }
const CGI_223 = { label: 'CGI, art. 223', url: `${LEGIFRANCE}LEGIARTI000034387974` }
const CALENDAR_MAY = { label: 'impots.gouv.fr : calendrier fiscal de mai 2026', url: 'https://www.impots.gouv.fr/professionnel/calendrier-fiscal/2026-05' }
const CALENDAR_JUNE = { label: 'impots.gouv.fr : calendrier fiscal de juin 2026', url: 'https://www.impots.gouv.fr/professionnel/calendrier-fiscal/2026-06' }
const BOI_DAS2 = {
  label: 'BOI-BIC-DECLA-30-70-20 (DAS2)',
  url: `${BOFIP}8661-PGP.html/identifiant=BOI-BIC-DECLA-30-70-20-20250212`,
}
const CVAE_PAGE = { label: 'impots.gouv.fr : CET, CFE et CVAE', url: 'https://www.impots.gouv.fr/professionnel/cet-cfe-et-cvae' }
const CVAE_2026 = {
  label: 'impots.gouv.fr : échéance de la 1330-CVAE en 2026',
  url: 'https://www.impots.gouv.fr/pro-05052026-cvae-echeance-teledeclaration-de-la-valeur-ajoutee-et-des-effectifs-salaries',
}
const CVAE_SECTION = {
  label: 'CGI, art. 1586 ter à 1586 nonies (CVAE)',
  url: `${LEGIFRANCE_SECTION}LEGITEXT000006069577/LEGISCTA000021576521/`,
}
const CGI_1679_SEPTIES = {
  label: 'CGI, art. 1679 septies (acomptes et solde de la CVAE)',
  url: `${LEGIFRANCE_SECTION}LEGITEXT000006069577/LEGISCTA000022892181/`,
}
const BOI_CVAE_DECLA = { label: 'BOI-CVAE-DECLA-10 (déclaration 1330-CVAE)', url: `${BOFIP}1091-PGP.html/identifiant=BOI-CVAE-DECLA-10-20240424` }
const LF_2025_ART_62 = {
  label: 'Loi n° 2025-127 du 14 février 2025, art. 62 (CVAE jusqu’en 2029, supprimée en 2030)',
  url: 'https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000051168728',
}
const CGI_1477 = { label: 'CGI, art. 1477 (déclarations de CFE)', url: `${LEGIFRANCE}LEGIARTI000030752139` }
const BOI_CFE_DECLA = { label: 'BOI-IF-CFE-30 (obligations déclaratives)', url: `${BOFIP}3957-PGP.html/identifiant=BOI-IF-CFE-30-20211201` }
const FORM_1447_C = {
  label: 'impots.gouv.fr : formulaire 1447-C-SD',
  url: 'https://www.impots.gouv.fr/formulaire/1447-c-sd/declaration-initiale-de-cotisation-fonciere-des-entreprises',
}
const CGI_1679_QUINQUIES = { label: 'CGI, art. 1679 quinquies', url: `${LEGIFRANCE}LEGIARTI000033812199` }
const CGI_1478 = { label: 'CGI, art. 1478', url: `${LEGIFRANCE}LEGIARTI000051202382` }
const L223_26 = { label: 'Code de commerce, art. L223-26 (SARL)', url: `${LEGIFRANCE}LEGIARTI000048535091` }
const L223_31 = { label: 'Code de commerce, art. L223-31 (EURL)', url: `${LEGIFRANCE}LEGIARTI000019291719` }
const L225_100 = { label: 'Code de commerce, art. L225-100 (SA)', url: `${LEGIFRANCE}LEGIARTI000048535138` }
const L227_9 = { label: 'Code de commerce, art. L227-9 (SAS)', url: `${LEGIFRANCE}LEGIARTI000019291762` }
const L232_22 = { label: 'Code de commerce, art. L232-22 (SARL)', url: `${LEGIFRANCE}LEGIARTI000048535223` }
const CGI_231 = { label: 'CGI, art. 231 (taxe sur les salaires)', url: `${LEGIFRANCE}LEGIARTI000051764961` }
const BOI_TS_DECLA = { label: 'BOI-TPS-TS-40 (déclaration et paiement de la taxe sur les salaires)', url: `${BOFIP}6683-PGP.html/identifiant=BOI-TPS-TS-40-20200624` }
const NOTICE_2501 = { label: 'Notice 2501-SD 2026', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/2501-sd/2026/2501-sd_5272.pdf' }
const R6352_23 = { label: 'Code du travail, art. R6352-22 à R6352-24 (bilan pédagogique et financier avant le 30 avril)', url: 'https://www.legifrance.gouv.fr/codes/id/LEGISCTA000018522310' }
const L232_23 = { label: 'Code de commerce, art. L232-23 (sociétés par actions)', url: `${LEGIFRANCE}LEGIARTI000039260292` }

export const RULES = {
  'tva-ca3': {
    id: 'tva-ca3',
    category: 'tva',
    form: 'CA3',
    summary:
      "Au réel normal, la TVA d'un mois est déclarée et payée le mois suivant (CA3), à une date comprise entre le 15 et le 24 selon la forme juridique, la situation géographique et le numéro SIREN : le 19 au plus tôt pour une société, le 23 pour une SA, le 15 pour un entrepreneur individuel. Quand la TVA annuelle est inférieure à 4 000 €, la déclaration peut être trimestrielle. Une échéance qui tombe un samedi, un dimanche ou un jour férié est reportée au premier jour ouvrable suivant.",
    sources: [CGI_287, CGI_ANN4_39, BOI_TVA_DATES],
  },
  'tva-ca12': {
    id: 'tva-ca12',
    category: 'tva',
    form: 'CA12',
    summary:
      "Au réel simplifié, la déclaration annuelle CA12 de l'année civile est due le deuxième jour ouvré qui suit le 1er mai (CA12E dans les trois mois de la clôture sur option, pour un exercice qui ne finit pas le 31 décembre). Le régime simplifié est supprimé au 1er janvier 2027 : la dernière CA12, celle de 2026, est due le 4 mai 2027, puis la TVA se déclare sur CA3, trimestrielle par défaut.",
    sources: [CGI_287, BOI_TVA_RSI, RSI_ABOLISHED],
  },
  'tva-acompte': {
    id: 'tva-acompte',
    category: 'tva',
    form: 'Acompte CA12',
    summary:
      "Au réel simplifié, deux acomptes sont versés en juillet (55 % de la TVA de l'année précédente) et en décembre (40 %), à la même date que la CA3 du mois pour la société. Pas d'acompte quand la TVA de l'année précédente est inférieure à 1 000 €. Les acomptes de 2027 tombent avec la suppression du régime simplifié.",
    sources: [CGI_287, BOI_TVA_RSI, RSI_ABOLISHED],
  },
  'is-acompte': {
    id: 'is-acompte',
    category: 'is',
    form: '2571',
    summary:
      "L'impôt sur les sociétés se paie par quatre acomptes, au plus tard les 15 mars, 15 juin, 15 septembre et 15 décembre. L'ordre suit la date de clôture (tableau du BOFiP) : par exemple 15 mars, 15 juin, 15 septembre puis 15 décembre pour une clôture entre le 20 novembre et le 19 février, 15 juin, 15 septembre, 15 décembre puis 15 mars pour une clôture entre le 20 février et le 19 mai. Un exercice plus court compte autant d'acomptes que d'échéances trimestrielles qu'il contient. Pas d'acompte quand l'impôt de référence ne dépasse pas 3 000 €, ni pendant le premier exercice d'une société nouvelle.",
    sources: [CGI_1668, BOI_IS_ACOMPTES],
  },
  'is-solde': {
    id: 'is-solde',
    category: 'is',
    form: '2572',
    summary:
      "Le solde de l'impôt sur les sociétés est payé au plus tard le 15 du quatrième mois qui suit la clôture, et le 15 mai de l'année suivante pour un exercice clos le 31 décembre. Avec le relevé de solde, la société régularise les acomptes versés.",
    sources: [CGI_1668, BOI_IS_ACOMPTES],
  },
  liasse: {
    id: 'liasse',
    category: 'liasse',
    form: '2065',
    summary:
      "La déclaration de résultat 2065 et la liasse fiscale (2033 au régime simplifié, 2050 à 2059 au régime normal) sont dues dans les trois mois de la clôture, et le deuxième jour ouvré qui suit le 1er mai pour un exercice clos le 31 décembre. L'administration accorde chaque année 15 jours de plus en cas de télédéclaration. Kledg retient le dernier jour du troisième mois pour une clôture en fin de mois, ramené au jour ouvré précédent quand il tombe un week-end, comme le calendrier fiscal 2026 (clôture au 28 février 2026 : 29 mai 2026).",
    sources: [CGI_223, CALENDAR_MAY, CALENDAR_JUNE],
  },
  das2: {
    id: 'das2',
    category: 'liasse',
    form: 'DAS2',
    summary:
      "La déclaration des honoraires, commissions et vacations versés à un même bénéficiaire au-delà de 2 400 € dans l'année civile est déposée avec la déclaration de résultat : le deuxième jour ouvré qui suit le 1er mai pour un exercice clos le 31 décembre, dans les trois mois de la clôture sinon, au titre de l'année civile précédente.",
    sources: [BOI_DAS2],
  },
  cvae: {
    id: 'cvae',
    category: 'cvae',
    form: '1330-CVAE',
    summary:
      "La déclaration de valeur ajoutée et des effectifs 1330-CVAE est obligatoire au-delà de 152 500 € de chiffre d'affaires hors taxes, même si la CVAE n'est due qu'au-delà de 500 000 €. Elle est déposée le deuxième jour ouvré qui suit le 1er mai, avec 15 jours de plus en cas de télédéclaration. La CVAE est supprimée à partir de 2030 (loi de finances pour 2025)\u00a0: la dernière 1330-CVAE est celle de 2029, déposée en 2030.",
    sources: [CVAE_PAGE, CVAE_2026, BOI_CVAE_DECLA, LF_2025_ART_62],
  },
  'cvae-acompte': {
    id: 'cvae-acompte',
    category: 'cvae',
    form: '1329-AC',
    summary:
      "Quand la CVAE de l'année précédente dépasse 1 500 €, deux acomptes de 50 % de la CVAE de l'année, calculée sur la dernière valeur ajoutée déclarée, sont versés au plus tard les 15 juin et 15 septembre avec le relevé 1329-AC. Plus d'acompte à partir de 2030, année de la suppression de la CVAE.",
    sources: [CGI_1679_SEPTIES, LF_2025_ART_62],
  },
  'cvae-solde': {
    id: 'cvae-solde',
    category: 'cvae',
    form: '1329-DEF',
    summary:
      "Le solde de la CVAE d'une année, ou toute la CVAE en l'absence d'acompte, est payé avec la déclaration de liquidation 1329-DEF au plus tard le deuxième jour ouvré qui suit le 1er mai de l'année suivante. Pas de CVAE sous 500 000 € de chiffre d'affaires, ni quand son montant ne dépasse pas 63 €. La dernière 1329-DEF est celle de 2029.",
    sources: [CGI_1679_SEPTIES, CVAE_SECTION, LF_2025_ART_62],
  },
  'cfe-acompte': {
    id: 'cfe-acompte',
    category: 'cfe',
    form: 'CFE',
    summary:
      "Un acompte de 50 % de la CFE de l'année précédente est payé au plus tard le 15 juin quand cette cotisation atteignait 3 000 €. Une date qui tombe un samedi, un dimanche ou un jour férié est reportée au jour ouvrable suivant.",
    sources: [CGI_1679_QUINQUIES],
  },
  cfe: {
    id: 'cfe',
    category: 'cfe',
    form: 'CFE',
    summary:
      "La cotisation foncière des entreprises (ou son solde après acompte) est payée au plus tard le 15 décembre, d'après l'avis disponible dans l'espace professionnel. Elle n'est pas due l'année de la création.",
    sources: [CGI_1679_QUINQUIES, CGI_1478],
  },
  'cfe-1447c': {
    id: 'cfe-1447c',
    category: 'cfe',
    form: '1447-C-SD',
    summary:
      "L'année de la création d'un établissement, la déclaration initiale de CFE 1447-C-SD est déposée avant le 1er janvier de l'année suivante, soit au plus tard le 31 décembre\u00a0: elle donne les éléments de la CFE de l'année suivante, qui ne porte pas sur l'année de création.",
    sources: [CGI_1477, FORM_1447_C, BOI_CFE_DECLA],
  },
  'cfe-1447m': {
    id: 'cfe-1447m',
    category: 'cfe',
    form: '1447-M-SD',
    summary:
      "Quand un élément de la CFE change (surface des locaux, activité, exonération demandée), la déclaration modificative 1447-M-SD est déposée au plus tard le deuxième jour ouvré qui suit le 1er mai. Sans changement, rien à déposer.",
    sources: [CGI_1477, BOI_CFE_DECLA],
  },
  'ts-releve': {
    id: 'ts-releve',
    category: 'salaires',
    form: '2501',
    summary:
      "La taxe sur les salaires se paie avec un relevé 2501 dans les quinze premiers jours du mois qui suit, quand la taxe de l'année précédente dépassait 10 000 €, ou du trimestre qui suit (avant les 15 avril, 15 juillet et 15 octobre) de 4 000 € à 10 000 €. Pas de relevé pour décembre ni pour le quatrième trimestre : ils sont réglés avec la déclaration annuelle.",
    sources: [CGI_231, BOI_TS_DECLA, NOTICE_2501],
  },
  'ts-2502': {
    id: 'ts-2502',
    category: 'salaires',
    form: '2502',
    summary:
      "La déclaration annuelle 2502 des salaires d'une année est déposée, avec le solde de la taxe, au plus tard le 15 janvier de l'année suivante ; il est admis qu'elle le soit jusqu'au 31 janvier. Rien à déposer quand la taxe n'est pas due (franchise de 1 200 €, abattement des associations).",
    sources: [CGI_231, BOI_TS_DECLA],
  },
  bpf: {
    id: 'bpf',
    category: 'formation',
    form: 'BPF (cerfa 10443)',
    summary:
      "Un organisme de formation adresse avant le 30 avril de chaque année le bilan pédagogique et financier de son dernier exercice clos, sur Mon Activité Formation. Le ministère prolonge la campagne chaque année par annonce (jusqu'au 31 mai en 2026). Sans bilan, la déclaration d'activité devient caduque (art. L6351-6).",
    sources: [R6352_23],
  },
  approbation: {
    id: 'approbation',
    category: 'juridique',
    form: 'Approbation des comptes',
    summary:
      "Les comptes annuels sont approuvés par les associés dans les six mois de la clôture, sauf prolongation par décision de justice (SARL, SA, SASU ; dans une SAS, selon les statuts). Dans une SASU dont l'associé unique, personne physique, est le président, et dans une EURL dont l'associé unique est le seul gérant, le dépôt au greffe des comptes signés dans ce délai vaut approbation.",
    sources: [L223_26, L223_31, L225_100, L227_9],
  },
  'depot-comptes': {
    id: 'depot-comptes',
    category: 'juridique',
    form: 'Dépôt des comptes',
    summary:
      "Les comptes approuvés sont déposés au greffe du tribunal de commerce dans le mois qui suit l'approbation, ou dans les deux mois en cas de dépôt par voie électronique. Kledg compte ce délai à partir de la date d'approbation enregistrée dans l'approbation des comptes, à défaut de la date limite d'approbation.",
    sources: [L232_22, L232_23],
  },
} as const satisfies Record<string, DeadlineRule>

export type RuleId = keyof typeof RULES

export const RULE_LIST: DeadlineRule[] = Object.values(RULES)
