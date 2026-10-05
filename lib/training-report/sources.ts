/**
 * Official sources of the bilan pédagogique et financier
 * (docs/organisme-de-formation.md). Verified on 5 October 2026 against
 * Legifrance, service-public.gouv.fr and travail-emploi.gouv.fr. Pure data.
 */

export interface TrainingReportSource {
  label: string
  url: string
}

export const TRAINING_REPORT_SOURCES = {
  l6352_11: { label: 'Code du travail, art. L6352-11 (bilan pédagogique et financier annuel)', url: 'https://code.travail.gouv.fr/code-du-travail/l6352-11' },
  r6352_22: { label: 'Code du travail, art. R6352-22 (contenu : activités de l’exercice comptable, stagiaires, heures, fonds reçus)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000039355607' },
  r6352_23: { label: 'Code du travail, art. R6352-23 (envoi avant le 30 avril de chaque année, par téléservice)', url: 'https://www.legifrance.gouv.fr/codes/id/LEGISCTA000018522310' },
  l6351_6: { label: 'Code du travail, art. L6351-6 (déclaration d’activité caduque sans bilan ou sans activité)', url: 'https://code.travail.gouv.fr/code-du-travail/l6351-6' },
  cerfa: { label: 'Formulaire cerfa n° 10443*17 (bilan pédagogique et financier)', url: 'https://www.formulaires.service-public.gouv.fr/gf/cerfa_10443_17.do' },
  notice: { label: 'Notice n° 50199#17 (cadres A à H, comptes 6411, 604 et 6226)', url: 'https://www.formulaires.service-public.gouv.fr/gf/getNotice.do?cerfaNotice=50199&cerfaFormulaire=10443' },
  portal: { label: 'Mon Activité Formation (dépôt en ligne)', url: 'https://www.monactiviteformation.emploi.gouv.fr/mon-activite-formation/' },
  campaign2026: { label: 'DREETS Bretagne : campagne 2026, dépôt prolongé jusqu’au 31 mai 2026', url: 'https://bretagne.dreets.gouv.fr/Campagne-2026-Depot-de-votre-Bilan-pedagogique-et-financier-BPF' },
  dreets: { label: 'Décret n° 2020-1545 du 9 décembre 2020 (DREETS et DRIEETS au 1er avril 2021)', url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000042636412' },
} as const satisfies Record<string, TrainingReportSource>
