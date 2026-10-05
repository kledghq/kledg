/**
 * Official sources of the taxe sur les salaires (docs/organisme-de-formation.md).
 * Verified on 5 October 2026 against Legifrance, BOFiP and the 2025 and
 * 2026 notices of forms 2501 and 2502. Pure data.
 */

export interface PayrollTaxSource {
  label: string
  url: string
}

const BOFIP = 'https://bofip.impots.gouv.fr/bofip/'

export const PAYROLL_TAX_SOURCES = {
  cgi231: { label: 'CGI, art. 231 (redevables, assiette, taux de 4,25 %, 8,50 % et 13,60 %, seuils de 2026)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051764961' },
  cgi1679: { label: 'CGI, art. 1679 (franchise de 1 200 €, décote jusqu’à 2 040 €)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000026950015' },
  cgi1679A: { label: 'CGI, art. 1679 A (abattement des associations, 24 256 € en 2026)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000049641164' },
  bofipRatio: { label: 'BOI-TPS-TS-20-30 (rapport d’assujettissement, arrondi à l’unité inférieure, tableau de 10 à 20 %)', url: `${BOFIP}6693-PGP.html/identifiant=BOI-TPS-TS-20-30-20220330` },
  bofipLiquidation: { label: 'BOI-TPS-TS-30 (liquidation, abattement après franchise et décote)', url: `${BOFIP}6686-PGP.html/identifiant=BOI-TPS-TS-30-20200624` },
  bofipFiling: { label: 'BOI-TPS-TS-40 (déclaration et paiement)', url: `${BOFIP}6683-PGP.html/identifiant=BOI-TPS-TS-40-20200624` },
  notice2501: { label: 'Notice 2501-SD 2026 (relevé de versement provisionnel, seuils mensuels et trimestriels)', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/2501-sd/2026/2501-sd_5272.pdf' },
  notice2501of2025: { label: 'Notice 2501-SD 2025', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/2501-sd/2025/2501-sd_4914.pdf' },
  notice2502: { label: 'Notice 2502-SD (déclaration annuelle des salaires 2025, calcul par tranches puis rapport)', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/2502-sd/2025/2502-sd_5241.pdf' },
  faq: { label: 'impots.gouv.fr : comment déclarer et payer ma taxe sur les salaires', url: 'https://www.impots.gouv.fr/professionnel/questions/comment-declarer-et-payer-ma-taxe-sur-les-salaires-ts' },
  pcg: { label: 'PCG, liste des comptes (6311 Taxe sur les salaires, 447 Autres impôts, taxes et versements assimilés)', url: 'https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/Plan-de-comptes-PCG-2025.pdf' },
} as const satisfies Record<string, PayrollTaxSource>
