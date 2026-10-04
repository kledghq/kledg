/**
 * Official texts the approval pack relies on (docs/approbation-des-comptes.md).
 * Checked on 4 October 2026 against the consolidated Code de commerce and
 * Code civil (Légifrance data, codes.droit.org export of 1 October 2026).
 * Pure data: shown next to each rule in the UI and in the generated
 * documents' notes.
 */

export interface LegalSource {
  /** "C. com., art. L223-26" */
  label: string
  url: string
}

const ARTICLE = 'https://www.legifrance.gouv.fr/codes/article_lc/'
const CODE_DE_COMMERCE = 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000005634379'
const CODE_CIVIL = 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006070721'
const CGI = 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006069577'

const com = (article: string, id?: string): LegalSource => ({
  label: `C. com., art. ${article}`,
  url: id ? `${ARTICLE}${id}` : CODE_DE_COMMERCE,
})
const civ = (article: string): LegalSource => ({ label: `C. civ., art. ${article}`, url: CODE_CIVIL })

export const SOURCES = {
  // Approval within six months, documents, assemblies
  L223_26: com('L223-26', 'LEGIARTI000048535091'),
  L223_27: com('L223-27', 'LEGIARTI000049720548'),
  L223_29: com('L223-29', 'LEGIARTI000038799356'),
  L223_31: com('L223-31', 'LEGIARTI000019291719'),
  L223_19: com('L223-19'),
  L223_22: com('L223-22'),
  L225_38: com('L225-38 à L225-40'),
  L225_98: com('L225-98'),
  L225_100: com('L225-100', 'LEGIARTI000048535138'),
  L225_253: com('L225-253'),
  L225_37: com('L225-37'),
  L227_1: com('L227-1'),
  L227_9: com('L227-9', 'LEGIARTI000051322706'),
  L227_10: com('L227-10'),
  R223_18: com('R223-18'),
  R223_20: com('R223-20'),
  R223_24: com('R223-24'),
  R223_26: com('R223-26'),
  R221_3: com('R221-3'),
  R225_69: com('R225-69'),
  R225_95: com('R225-95'),
  R225_100: com('R225-100'),
  R225_106: com('R225-106'),
  // Accounts, management report, size categories
  L232_1: com('L232-1', 'LEGIARTI000051559593'),
  L232_10: com('L232-10'),
  L232_11: com('L232-11'),
  L123_16: com('L123-16'),
  L123_16_1: com('L123-16-1'),
  L123_16_2: com('L123-16-2'),
  L230_1: com('L230-1'),
  D123_200: com('D123-200'),
  // Filing and publication
  L232_22: com('L232-22', 'LEGIARTI000048535223'),
  L232_23: com('L232-23', 'LEGIARTI000039260292'),
  L232_25: com('L232-25'),
  L233_16: com('L233-16'),
  R123_111: com('R123-111'),
  R123_111_1: com('R123-111-1'),
  R247_3: com('R247-3'),
  L123_5_1: com('L123-5-1'),
  L241_5: com('L241-5'),
  // Sociétés civiles
  CIV_1852: civ('1852'),
  CIV_1853: civ('1853'),
  CIV_1856: civ('1856'),
  D78_704: { label: 'Décret n° 78-704 du 3 juillet 1978, art. 40 et 41', url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000886605' },
  // Tax mentions of the minutes
  CGI_243_BIS: { label: 'CGI, art. 243 bis', url: CGI },
  CGI_223_QUATER: { label: 'CGI, art. 223 quater et 39, 4', url: CGI },
  // Filing channel
  GUICHET_UNIQUE: { label: 'Guichet unique des formalités des entreprises (INPI)', url: 'https://formalites.entreprises.gouv.fr' },
} as const satisfies Record<string, LegalSource>

export type SourceKey = keyof typeof SOURCES
