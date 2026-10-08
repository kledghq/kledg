/**
 * Lines of the official forms of fixed assets and depreciation, 2026
 * editions, and the PCG accounts each line reads (pure module):
 *
 * - 2054-SD "Immobilisations" (régime réel normal, CGI art. 53 A): cadre A,
 *   gross value at the start, increases from a revaluation, acquisitions,
 *   creations, contributions and transfers; cadre B, transfers out, disposals
 *   or retirements, gross value at the end, original value of revalued items;
 * - 2055-SD "Amortissements", cadre A: depreciation at the start, allowances,
 *   decreases (items that left the assets, reversals), depreciation at the end;
 * - 2033-C-SD (régime simplifié, CGI art. 302 septies A bis), cadres I and II.
 *
 * Box codes are those printed on the DGFiP forms n° 2054-SD 2026, 2055-SD
 * 2026 (liasse 2050, impots.gouv.fr) and 2033-C-SD 2026. The forms print the
 * digit zero as "Ø" in some codes ("ØG"): written "0" here.
 *
 * Account mapping (PCG art. 932-1, chart of accounts as amended by règlement
 * ANC 2022-06): prefixes, the most specific prefix wins, like the balance
 * sheet mapping (lib/reports/statements/allocation.ts). Gross values are the
 * accounts 20 to 27, except 269 and 279 (versements restant à effectuer,
 * a debt), depreciation the accounts 28; impairments (29) are not
 * depreciation and appear on the provisions note (2056, 2033-D).
 */

export type Rubrique = 'intangible' | 'tangible' | 'financial'

/** Columns of 2054-SD: cadre A (opening, revaluation, increase), cadre B (transferOut, disposal, closing, origin). */
export type AssetColumn = 'opening' | 'revaluation' | 'increase' | 'transferOut' | 'disposal' | 'closing' | 'origin'
/** Columns of 2055-SD cadre A and 2033-C-SD cadre II. */
export type DepreciationColumn = 'opening' | 'allowance' | 'decrease' | 'closing'
/** Columns of 2033-C-SD cadre I (increases include revaluations, decreases include transfers). */
export type SimplifiedAssetColumn = 'opening' | 'increase' | 'decrease' | 'closing'

export interface FormLineDef<C extends string> {
  kind: 'line'
  id: string
  label: string
  rubrique: Rubrique
  prefixes: readonly string[]
  codes: Partial<Record<C, string>>
}

export interface FormTotalDef<C extends string> {
  kind: 'total'
  id: string
  label: string
  /** Ids of the lines summed. */
  of: readonly string[]
  codes: Partial<Record<C, string>>
}

export type FormEntryDef<C extends string> = FormLineDef<C> | FormTotalDef<C>

const a = (opening: string, revaluation: string, increase: string, transferOut: string, disposal: string, closing: string, origin: string) =>
  ({ opening, revaluation, increase, transferOut, disposal, closing, origin }) satisfies Record<AssetColumn, string>
const d = (opening: string, allowance: string, decrease: string, closing: string) => ({ opening, allowance, decrease, closing }) satisfies Record<DepreciationColumn, string>
const s = (opening: string, increase: string, decrease: string, closing: string) => ({ opening, increase, decrease, closing }) satisfies Record<SimplifiedAssetColumn, string>

const line = <C extends string>(id: string, label: string, rubrique: Rubrique, prefixes: string[], codes: Partial<Record<C, string>>): FormLineDef<C> => ({
  kind: 'line',
  id,
  label,
  rubrique,
  prefixes,
  codes,
})
const total = <C extends string>(id: string, label: string, of: string[], codes: Partial<Record<C, string>>): FormTotalDef<C> => ({ kind: 'total', id, label, of, codes })

const TANGIBLE_2054 = ['land', 'buildingsOwn', 'buildingsOther', 'buildingFixtures', 'equipment', 'generalFixtures', 'transport', 'office', 'otherTangible', 'inProgress', 'advances']
const FINANCIAL_2054 = ['equityMethod', 'otherParticipations', 'otherSecurities', 'loans']

/** Form 2054-SD 2026. Frais d'établissement (total I) and autres incorporelles (total II) are one line each. */
export const FORM_2054: readonly FormEntryDef<AssetColumn>[] = [
  line('establishment', "Frais d'établissement et de développement (total I)", 'intangible', ['201', '203'], a('CZ', 'D8', 'D9', 'IN', 'C0', 'D0', 'D7')),
  line('otherIntangible', "Autres postes d'immobilisations incorporelles (total II)", 'intangible', ['20', '232', '237'], a('KD', 'KE', 'KF', 'IO', 'LV', 'LW', '1X')),
  line('land', 'Terrains', 'tangible', ['211', '212'], a('KG', 'KH', 'KI', 'IP', 'LX', 'LY', 'LZ')),
  line('buildingsOwn', 'Constructions sur sol propre', 'tangible', ['213'], a('KJ', 'KK', 'KL', 'IQ', 'MA', 'MB', 'MC')),
  line('buildingsOther', "Constructions sur sol d'autrui", 'tangible', ['214'], a('KM', 'KN', 'KO', 'IR', 'MD', 'ME', 'MF')),
  line('buildingFixtures', 'Installations générales, agencements, aménagements des constructions', 'tangible', ['2135', '2145'], a('KP', 'KQ', 'KR', 'IS', 'MG', 'MH', 'MI')),
  line('equipment', 'Installations techniques, matériel et outillage industriels', 'tangible', ['215'], a('KS', 'KT', 'KU', 'IT', 'MJ', 'MK', 'ML')),
  line('generalFixtures', 'Installations générales, agencements, aménagements divers', 'tangible', ['2181'], a('KV', 'KW', 'KX', 'IU', 'MM', 'MN', 'MO')),
  line('transport', 'Matériel de transport', 'tangible', ['2182'], a('KY', 'KZ', 'LA', 'IV', 'MP', 'MQ', 'MR')),
  line('office', 'Matériel de bureau et informatique, mobilier', 'tangible', ['2183', '2184'], a('LB', 'LC', 'LD', 'IW', 'MS', 'MT', 'MU')),
  line('otherTangible', 'Emballages récupérables et divers', 'tangible', ['21', '218', '22'], a('LE', 'LF', 'LG', 'IX', 'MV', 'MW', 'MX')),
  line('inProgress', 'Immobilisations corporelles en cours', 'tangible', ['23', '231'], a('LH', 'LI', 'LJ', 'MY', 'MZ', 'NA', 'NB')),
  line('advances', 'Avances et acomptes', 'tangible', ['238'], a('LK', 'LL', 'LM', 'NC', 'ND', 'NE', 'NF')),
  total('tangibleTotal', 'Total III (immobilisations corporelles)', TANGIBLE_2054, a('LN', 'LO', 'LP', 'IY', 'NG', 'NH', 'NI')),
  // Kledg's chart has no account for titres mis en équivalence: the line is always empty
  line('equityMethod', 'Participations évaluées par mise en équivalence', 'financial', [], a('8G', '8M', '8T', 'IZ', '0U', 'M7', '0W')),
  line('otherParticipations', 'Autres participations', 'financial', ['26'], a('8U', '8V', '8W', 'I0', '0X', '0Y', '0Z')),
  line('otherSecurities', 'Autres titres immobilisés', 'financial', ['271', '272', '273', '277'], a('1P', '1R', '1S', 'I1', '2B', '2C', '2D')),
  line('loans', 'Prêts et autres immobilisations financières', 'financial', ['27', '267', '268'], a('1T', '1U', '1V', 'I2', '2E', '2F', '2G')),
  total('financialTotal', 'Total IV (immobilisations financières)', FINANCIAL_2054, a('LQ', 'LR', 'LS', 'I3', 'NJ', 'NK', '2H')),
  total('grandTotal', 'Total général (I + II + III + IV)', ['establishment', 'otherIntangible', ...TANGIBLE_2054, ...FINANCIAL_2054], a('0G', '0H', '0J', 'I4', '0K', '0L', '0M')),
]

const INTANGIBLE_2055 = ['establishment', 'goodwill', 'otherIntangible']
const TANGIBLE_2055 = ['land', 'buildingsOwn', 'buildingsOther', 'buildingFixtures', 'equipment', 'generalFixtures', 'transport', 'office', 'otherTangible']

/** Form 2055-SD 2026, cadre A (amortissements techniques). */
export const FORM_2055: readonly FormEntryDef<DepreciationColumn>[] = [
  line('establishment', "Frais d'établissement et de développement", 'intangible', ['2801', '2803'], d('CY', 'EL', 'EM', 'EN')),
  line('goodwill', 'Fonds commercial', 'intangible', ['2806', '2807'], d('RE', 'RF', 'RI', 'RJ')),
  line('otherIntangible', 'Autres immobilisations incorporelles', 'intangible', ['280'], d('PE', 'PF', 'PG', 'PH')),
  total('intangibleTotal', 'Total I (incorporelles)', INTANGIBLE_2055, d('RK', 'RM', 'RN', 'RO')),
  line('land', 'Terrains', 'tangible', ['2811', '2812'], d('PI', 'PJ', 'PK', 'PL')),
  line('buildingsOwn', 'Constructions sur sol propre', 'tangible', ['2813'], d('PM', 'PN', 'PO', 'PQ')),
  line('buildingsOther', "Constructions sur sol d'autrui", 'tangible', ['2814'], d('PR', 'PS', 'PT', 'PU')),
  line('buildingFixtures', 'Installations générales, agencements et aménagements des constructions', 'tangible', ['28135', '28145'], d('PV', 'PW', 'PX', 'PY')),
  line('equipment', 'Installations techniques, matériel et outillage industriels', 'tangible', ['2815'], d('PZ', 'QA', 'QB', 'QC')),
  line('generalFixtures', 'Installations générales, agencements, aménagements divers', 'tangible', ['28181'], d('QD', 'QE', 'QF', 'QG')),
  line('transport', 'Matériel de transport', 'tangible', ['28182'], d('QH', 'QI', 'QJ', 'QK')),
  line('office', 'Matériel de bureau et informatique, mobilier', 'tangible', ['28183', '28184'], d('QL', 'QM', 'QN', 'QO')),
  line('otherTangible', 'Emballages récupérables et divers', 'tangible', ['28', '281', '2818', '282'], d('QP', 'QR', 'QS', 'QT')),
  total('tangibleTotal', 'Total II (corporelles)', TANGIBLE_2055, d('QU', 'QV', 'QW', 'QX')),
  total('grandTotal', 'Total général (I + II)', [...INTANGIBLE_2055, ...TANGIBLE_2055], d('0N', '0P', '0Q', '0R')),
]

/** Form 2033-C-SD 2026, cadre I (immobilisations). Goodwill (206, 207) is apart from the other intangibles here. */
export const FORM_2033C_ASSETS: readonly FormEntryDef<SimplifiedAssetColumn>[] = [
  line('goodwill', 'Fonds commercial', 'intangible', ['206', '207'], s('400', '402', '404', '406')),
  line('otherIntangible', 'Autres immobilisations incorporelles', 'intangible', ['20', '232', '237'], s('410', '412', '414', '416')),
  line('land', 'Terrains', 'tangible', ['211', '212'], s('420', '422', '424', '426')),
  line('buildings', 'Constructions', 'tangible', ['213', '214'], s('430', '432', '434', '436')),
  line('equipment', 'Installations techniques, matériel et outillage industriels', 'tangible', ['215'], s('440', '442', '444', '446')),
  line('generalFixtures', 'Installations générales, agencements, aménagements divers', 'tangible', ['2181'], s('450', '452', '454', '456')),
  line('transport', 'Matériel de transport', 'tangible', ['2182'], s('460', '462', '464', '466')),
  line('otherTangible', 'Autres immobilisations corporelles', 'tangible', ['21', '22', '23'], s('470', '472', '474', '476')),
  line('financial', 'Immobilisations financières', 'financial', ['26', '27'], s('480', '482', '484', '486')),
  total('grandTotal', 'Total', ['goodwill', 'otherIntangible', 'land', 'buildings', 'equipment', 'generalFixtures', 'transport', 'otherTangible', 'financial'], s('490', '492', '494', '496')),
]

/** Form 2033-C-SD 2026, cadre II (amortissements). */
export const FORM_2033C_DEPRECIATION: readonly FormEntryDef<DepreciationColumn>[] = [
  line('goodwill', 'Fonds commercial', 'intangible', ['2806', '2807'], d('495', '497', '498', '499')),
  line('otherIntangible', 'Autres immobilisations incorporelles', 'intangible', ['280'], d('500', '502', '504', '506')),
  line('land', 'Terrains', 'tangible', ['2811', '2812'], d('510', '512', '514', '516')),
  line('buildings', 'Constructions', 'tangible', ['2813', '2814'], d('520', '522', '524', '526')),
  line('equipment', 'Installations techniques, matériel et outillage industriels', 'tangible', ['2815'], d('530', '532', '534', '536')),
  line('generalFixtures', 'Installations générales, agencements, aménagements divers', 'tangible', ['28181'], d('540', '542', '544', '546')),
  line('transport', 'Matériel de transport', 'tangible', ['28182'], d('550', '552', '554', '556')),
  line('otherTangible', 'Autres immobilisations corporelles', 'tangible', ['28', '281'], d('560', '562', '564', '566')),
  total('grandTotal', 'Total', ['goodwill', 'otherIntangible', 'land', 'buildings', 'equipment', 'generalFixtures', 'transport', 'otherTangible'], d('570', '572', '574', '576')),
]

/** Accounts of gross fixed assets: 20 to 27, without 269 and 279 (amounts still to pay on securities, a debt). */
export function isGrossFixedAssetAccount(code: string): boolean {
  return /^2[0-7]/.test(code) && !code.startsWith('269') && !code.startsWith('279')
}

export function isDepreciationAccount(code: string): boolean {
  return code.startsWith('28')
}

/** The line of `form` an account belongs to: the most specific matching prefix; null when none. */
export function lineOf<C extends string>(form: readonly FormEntryDef<C>[], code: string): FormLineDef<C> | null {
  let best: FormLineDef<C> | null = null
  let bestLength = -1
  for (const entry of form) {
    if (entry.kind !== 'line') continue
    for (const prefix of entry.prefixes) {
      if (code.startsWith(prefix) && prefix.length > bestLength) {
        best = entry
        bestLength = prefix.length
      }
    }
  }
  return best
}

