/**
 * Official sources of the local taxes page (docs/impots-locaux.md). Every
 * rule of lib/local-taxes names one of these; the page, the exports and the
 * MCP tool list them. Verified on 5 October 2026 against Legifrance, BOFiP
 * and impots.gouv.fr. Pure data, usable on both sides.
 */

export interface LocalTaxSource {
  label: string
  url: string
}

const LEGIFRANCE = 'https://www.legifrance.gouv.fr/codes/article_lc/'
const BOFIP = 'https://bofip.impots.gouv.fr/bofip/'

export const LOCAL_TAX_SOURCES = {
  cgi1447: { label: 'CGI, art. 1447 (CFE due chaque année par les personnes qui exercent une activité professionnelle non salariée)', url: `${LEGIFRANCE}LEGIARTI000023380872` },
  cgi1467: { label: 'CGI, art. 1467 (base de la CFE\u00a0: valeur locative des biens passibles de taxe foncière utilisés pour l’activité)', url: `${LEGIFRANCE}LEGIARTI000030060638` },
  cgi1477: { label: 'CGI, art. 1477 (déclarations 1447-C-SD et 1447-M-SD)', url: `${LEGIFRANCE}LEGIARTI000030752139` },
  cgi1478: { label: 'CGI, art. 1478, II (pas de CFE l’année de création, base réduite de moitié l’année suivante)', url: `${LEGIFRANCE}LEGIARTI000051202382` },
  cgi1647D: { label: 'CGI, art. 1647 D (cotisation minimum ; exonération jusqu’à 5 000 € de chiffre d’affaires)', url: `${LEGIFRANCE}LEGIARTI000038686433` },
  cgi1647Bsexies: { label: 'CGI, art. 1647 B sexies (plafonnement de la CET en fonction de la valeur ajoutée)', url: `${LEGIFRANCE}LEGIARTI000048860242` },
  cgi1679quinquies: { label: 'CGI, art. 1679 quinquies (acompte de CFE du 15 juin, solde au 15 décembre)', url: `${LEGIFRANCE}LEGIARTI000033812199` },
  cgi1586ter: { label: 'CGI, art. 1586 ter à 1586 nonies (CVAE)', url: 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069577/LEGISCTA000021576521/' },
  cgi1586quater: { label: 'CGI, art. 1586 quater (taux progressif, dégrèvement sous 2 000 000 €)', url: `${LEGIFRANCE}LEGIARTI000048860944` },
  cgi1586sexies: { label: 'CGI, art. 1586 sexies (valeur ajoutée, plafonnée à 80 % ou 85 % du chiffre d’affaires)', url: `${LEGIFRANCE}LEGIARTI000043048297` },
  cgi1586octies: { label: 'CGI, art. 1586 octies (déclaration de la valeur ajoutée au-delà de 152 500 €)', url: `${LEGIFRANCE}LEGIARTI000042909509` },
  cgi1679septies: { label: 'CGI, art. 1679 septies (acomptes 1329-AC et solde 1329-DEF de la CVAE)', url: 'https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069577/LEGISCTA000022892181/' },
  lf2025: { label: 'Loi n° 2025-127 du 14 février 2025 de finances pour 2025, art. 62 (taux de 2026 et 2027 à 0,28 %, contribution complémentaire de 2025, suppression en 2030)', url: 'https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000051168728' },
  bofipCvaeRates: { label: 'BOI-CVAE-LIQ-10 (taux par année, arrondi au centième, dégrèvement, franchise de 63 €)', url: `${BOFIP}839-PGP.html/identifiant=BOI-CVAE-LIQ-10-20251119` },
  bofipCvaeDecla: { label: 'BOI-CVAE-DECLA-10 (déclaration 1330-CVAE)', url: `${BOFIP}1091-PGP.html/identifiant=BOI-CVAE-DECLA-10-20240424` },
  bofipCfeDecla: { label: 'BOI-IF-CFE-30 (obligations déclaratives de la CFE)', url: `${BOFIP}3957-PGP.html/identifiant=BOI-IF-CFE-30-20211201` },
  bofipCfeMinimum: { label: 'BOI-IF-CFE-20-20-40-10 (cotisation minimum)', url: `${BOFIP}9617-PGP.html/identifiant=BOI-IF-CFE-20-20-40-10-20190626` },
  bofipPlafonnement: { label: 'BOI-IF-CFE-40-30-20-30 (plafonnement en fonction de la valeur ajoutée, taux par année)', url: `${BOFIP}2594-PGP.html/identifiant=BOI-IF-CFE-40-30-20-30-20251119` },
  form1447C: { label: 'Formulaire 1447-C-SD (déclaration initiale de CFE)', url: 'https://www.impots.gouv.fr/formulaire/1447-c-sd/declaration-initiale-de-cotisation-fonciere-des-entreprises' },
  form1330: { label: 'Formulaire 1330-CVAE-SD 2026 et sa notice', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/1330-cvae-sd/2026/1330-cvae-sd_5410.pdf' },
  form1329AC: { label: 'Formulaire 1329-AC-SD 2026 (relevé d’acompte de CVAE)', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/1329-ac-sd/2026/1329-ac-sd_5492.pdf' },
  cetPage: { label: 'impots.gouv.fr\u00a0: CET, CFE et CVAE', url: 'https://www.impots.gouv.fr/professionnel/cet-cfe-et-cvae' },
} as const satisfies Record<string, LocalTaxSource>

export type LocalTaxSourceKey = keyof typeof LOCAL_TAX_SOURCES
