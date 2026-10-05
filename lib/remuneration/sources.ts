/**
 * Official sources of the "Rémunération et dividendes" simulator
 * (docs/remuneration-dividendes.md). Every rule of lib/remuneration names
 * one of these; the page, the exports and the MCP tool list them. Pure
 * data, usable on both sides. Checked on 5 October 2026. An article whose
 * permanent link was not verified links to its code on Légifrance.
 */

export interface RemunerationSource {
  label: string
  url: string
}

export const REMUNERATION_SOURCES = {
  lfi2026: { label: 'Loi n° 2026-103 du 19 février 2026 de finances pour 2026 (art. 4 : barème de l’impôt sur le revenu)', url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053508155' },
  lfss2026: { label: 'Loi n° 2025-1403 du 30 décembre 2025 de financement de la sécurité sociale pour 2026 (art. 12 : CSG de 10,6 % sur les revenus de capitaux)', url: 'https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000053226452' },
  cgi197: { label: 'CGI, art. 197 (barème, quotient familial et son plafonnement, décote)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1419' },
  cgi83: { label: 'CGI, art. 83, 3° et BOI-BAREME-000035 (déduction de 10 % : 509 € à 14 555 €)', url: 'https://bofip.impots.gouv.fr/bofip/10855-PGP.html/identifiant=BOI-BAREME-000035-20260217' },
  cgi62: { label: 'CGI, art. 62 (rémunération des gérants majoritaires, imposée comme un salaire)', url: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006069577' },
  cgi200A: { label: 'CGI, art. 200 A (prélèvement forfaitaire unique de 12,8 % et option globale pour le barème)', url: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006069577' },
  cgi158: { label: 'CGI, art. 158, 3, 2° (abattement de 40 % sur les dividendes au barème)', url: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006069577' },
  cgi154quinquies: { label: 'CGI, art. 154 quinquies, II (CSG déductible de 6,8 % au barème)', url: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006069577' },
  cgi219: { label: 'CGI, art. 219, I (impôt sur les sociétés : 15 % jusqu’à 42 500 €, 25 % au-delà)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046868562' },
  ccomL232_10: { label: 'Code de commerce, art. L232-10 (réserve légale : un vingtième du bénéfice jusqu’au dixième du capital)', url: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000005634379' },
  ccomL232_11: { label: 'Code de commerce, art. L232-11 (bénéfice distribuable)', url: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000005634379' },
  cssL131_6: { label: 'CSS, art. L131-6 (assiette des travailleurs indépendants ; dividendes au-delà de 10 % du capital, des primes et du compte courant)', url: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006073189' },
  cssL136_8: { label: 'CSS, art. L136-8 (taux de la CSG)', url: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006073189' },
  decret2024_688: { label: 'Décret n° 2024-688 du 5 juillet 2024 (assiette unique et taux des cotisations des indépendants : maladie 8,5 % jusqu’à 3 PASS, retraite de base, abattement de 26 %)', url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000049888566' },
  urssafTns: { label: 'URSSAF, réforme du calcul des cotisations des indépendants', url: 'https://www.urssaf.fr/accueil/independant/comprendre-payer-cotisations/reforme-cotisations-independants.html' },
  urssafRates: { label: 'URSSAF, taux de cotisations du secteur privé 2026', url: 'https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/taux-cotisations-secteur-prive.html' },
  boss: { label: 'BOSS, assiette générale et CSG-CRDS des revenus d’activité (abattement de 1,75 %)', url: 'https://boss.gouv.fr' },
  pass2026: { label: 'Arrêté du 22 décembre 2025 (plafond de la sécurité sociale 2026 : 48 060 €)', url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053143451' },
  agircArrco: { label: 'Agirc-Arrco, taux de cotisation 2026 (T1, T2, CEG, CET)', url: 'https://www.agirc-arrco.fr' },
  simulator: { label: 'Simulateur officiel de l’URSSAF (mon-entreprise.urssaf.fr), pour un calcul détaillé', url: 'https://mon-entreprise.urssaf.fr' },
} as const satisfies Record<string, RemunerationSource>

export type RemunerationSourceKey = keyof typeof REMUNERATION_SOURCES

/** Sources that apply to a status (every simulation cites the IS, the reserve, the dividends and the income tax). */
export function sourcesFor(status: 'assimile' | 'tns'): RemunerationSource[] {
  const common: RemunerationSourceKey[] = ['cgi219', 'ccomL232_10', 'ccomL232_11', 'cgi200A', 'cgi158', 'cgi154quinquies', 'lfss2026', 'cssL136_8', 'cgi197', 'cgi83', 'lfi2026', 'pass2026']
  const own: RemunerationSourceKey[] = status === 'tns' ? ['cgi62', 'cssL131_6', 'decret2024_688', 'urssafTns'] : ['urssafRates', 'agircArrco', 'boss']
  const keys: RemunerationSourceKey[] = [...common, ...own, 'simulator']
  return keys.map((key) => REMUNERATION_SOURCES[key])
}
