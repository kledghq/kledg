/**
 * Official sources of the impôt sur les sociétés worksheet
 * (docs/impot-societes.md). Every rule of lib/corporate-tax names one of
 * these; the page, the exports and the MCP tool list the ones that apply.
 * Pure data, usable on both sides.
 */

export interface CorporateTaxSource {
  label: string
  url: string
}

export const CORPORATE_TAX_SOURCES = {
  cgi39: { label: 'CGI, art. 39 (charges déductibles ; 2 : sanctions et pénalités ; 4 : dépenses somptuaires)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053542680' },
  cgi145: { label: 'CGI, art. 145 (régime des sociétés mères : 5 % du capital, titres nominatifs, deux ans)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051203497' },
  cgi209: { label: 'CGI, art. 209, I (report en avant des déficits : 1 000 000 € majorés de 50 %)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042909650/' },
  cgi213: { label: 'CGI, art. 213 (l’impôt sur les sociétés et les taxes sur les véhicules ne sont pas déductibles)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006303491' },
  cgi216: { label: 'CGI, art. 216 (quote-part de frais et charges de 5 %)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048831340' },
  cgi219: { label: 'CGI, art. 219, I (taux normal de 25 %, taux réduit de 15 % jusqu’à 42 500 €)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046868562' },
  cgi235terZC: { label: 'CGI, art. 235 ter ZC (contribution sociale de 3,3 %)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031011715' },
  cgi1668: { label: 'CGI, art. 1668 (acomptes et solde)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033836779/' },
  bofipLiqRate: { label: 'BOI-IS-LIQ-20-10 (taux réduit des PME)', url: 'https://bofip.impots.gouv.fr/bofip/2062-PGP.html/identifiant=BOI-IS-LIQ-20-10-20230621' },
  bofipDeficits: { label: 'BOI-IS-DEF-10-30 (imputation des déficits)', url: 'https://bofip.impots.gouv.fr/bofip/2103-PGP.html/identifiant=BOI-IS-DEF-10-30-20130410' },
  bofipParent: { label: 'BOI-IS-BASE-10-10 (régime des sociétés mères et filiales)', url: 'https://bofip.impots.gouv.fr/bofip/4516-PGP.html/identifiant=BOI-IS-BASE-10-10-20200415' },
  bofipAcomptes: { label: 'BOI-IS-DECLA-20-10 (acomptes et solde, § 60 à 130 et 360 à 370)', url: 'https://bofip.impots.gouv.fr/bofip/3558-PGP.html' },
  bofipNewCompanies: { label: 'BOI-IS-DECLA-20-30 (cas particuliers de paiement : sociétés nouvelles)', url: 'https://bofip.impots.gouv.fr/bofip/3564-PGP.html/identifiant=BOI-IS-DECLA-20-30-20200610' },
  bofipSocial: { label: 'BOI-IS-AUT-10-30 (contribution sociale, paiement)', url: 'https://bofip.impots.gouv.fr/bofip/3493-PGP.html/identifiant=BOI-IS-AUT-10-30-20130318' },
  form2033: { label: 'Liasse 2033-SD 2026, tableau 2033-B-SD (résultat fiscal), et sa notice n° 2033-NOT-SD', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/2033-sd/2026/2033-sd_5394.pdf' },
  form2050: { label: 'Liasse 2050 2026, tableau 2058-A-SD (détermination du résultat fiscal)', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/2050-liasse/2026/2050-liasse_5320.pdf' },
  form2065: { label: 'Formulaire 2065-SD (déclaration de résultat)', url: 'https://www.impots.gouv.fr/formulaire/2065-sd/impot-sur-les-societes' },
  form2571: { label: 'Formulaire 2571-SD (relevé d’acompte)', url: 'https://www.impots.gouv.fr/formulaire/2571-sd/releve-dacompte-dis' },
  form2572: { label: 'Formulaire 2572-SD (relevé de solde)', url: 'https://www.impots.gouv.fr/formulaire/2572-sd/releve-de-solde' },
} as const satisfies Record<string, CorporateTaxSource>

export type CorporateTaxSourceKey = keyof typeof CORPORATE_TAX_SOURCES
