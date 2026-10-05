/**
 * Official sources of the coefficient de déduction (docs/organisme-de-formation.md).
 * Every rule of lib/vat-deduction names one of these; the page and the MCP
 * tool list them. Verified on 5 October 2026 against Legifrance, BOFiP and
 * the 2026 VAT return notices. Pure data, usable on both sides.
 */

export interface VatDeductionSource {
  label: string
  url: string
}

const BOFIP = 'https://bofip.impots.gouv.fr/bofip/'

export const VAT_DEDUCTION_SOURCES = {
  ann2art205: { label: 'CGI, annexe II, art. 205 (TVA déductible à proportion du coefficient de déduction)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000036174761/' },
  ann2art206: {
    label: 'CGI, annexe II, art. 206 (coefficients d’assujettissement, de taxation et d’admission ; arrondis par excès à la deuxième décimale ; arrêtés avant le 25 avril de l’année suivante)',
    url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000036174761/',
  },
  ann2art207: { label: 'CGI, annexe II, art. 207 (régularisations, immobilisations)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031699880' },
  ann2art209: { label: 'CGI, annexe II, art. 209 et BOI-TVA-DED-20-20 (secteurs distincts d’activité)', url: `${BOFIP}1404-PGP.html` },
  cgi261: { label: 'CGI, art. 261, 4, 4° a (formation professionnelle continue exonérée, attestation)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042909959/' },
  cgi293B: { label: 'CGI, art. 293 B (franchise en base : pas de déduction)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045035275' },
  bofipDed10: { label: 'BOI-TVA-DED-20-10 (coefficient de déduction)', url: `${BOFIP}1637-PGP.html` },
  bofipTaxation: { label: 'BOI-TVA-DED-20-10-20 (coefficient de taxation : numérateur, dénominateur, exclusions)', url: `${BOFIP}1665-PGP.html` },
  bofipRounding: { label: 'BOI-TVA-DED-20-10-40 (arrondi par excès, coefficient provisoire de l’année précédente, régularisation avant le 25 avril)', url: `${BOFIP}1674-PGP.html` },
  bofipRegularisation: { label: 'BOI-TVA-DED-60-10 (régularisation sur la déclaration déposée au plus tard le 25 avril)', url: `${BOFIP}1678-PGP.html` },
  bofipTraining: { label: 'BOI-TVA-CHAMP-30-10-20-50 (formation professionnelle continue : exonération sans option)', url: `${BOFIP}943-PGP.html` },
  ca3Notice: { label: 'Notice 3310-NOT-CA3-SD 2026 (lignes 15, 21 et 22A)', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/3310-ca3-sd/2026/3310-ca3-sd_5426.pdf' },
  ca12Notice: { label: 'Notice 3517-S-NOT-SD 2026 (lignes 18, 25 et 25A)', url: 'https://www.impots.gouv.fr/sites/default/files/formulaires/3517-s-sd/2026/3517-s-sd_5424.pdf' },
} as const satisfies Record<string, VatDeductionSource>
