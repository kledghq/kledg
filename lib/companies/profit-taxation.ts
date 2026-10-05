/**
 * How the profits of a company are taxed on a day: impôt sur les sociétés
 * (IS) or impôt sur le revenu of the exploitant or the associés (IR), on
 * plain values. Pure module (no imports): the expense report and simple
 * mode rules on meals (lib/expense-reports/exploitant-meals.ts), the
 * services and the UI share it.
 *
 * Kledg records the corporate tax regime of a company in its tax regime
 * history (lib/companies/tax-regimes.ts, regimeType corporateTax) and in
 * Company.corporateTaxRegime: normal or simplified (IS), micro, and
 * income_tax ("Impôt sur le revenu", for a company at IR by law or by
 * option). A null company field means "not subject to IS" when the wizard
 * or the MCP created the company, but also "not set" for older companies:
 * it is never read as IR on its own. In order:
 *
 * 1. the regime of the day (history row covering it, else the company
 *    field): normal or simplified: IS; income_tax: IR; micro: IR under the
 *    micro regime (the profit is a flat share of the turnover, real
 *    charges are not deducted);
 * 2. else the legal form:
 *    - EI, SNC, SCS, SCI: IR (CGI art. 8, 1° and 2°: the associés of a
 *      société de personnes are taxed on their share; an entrepreneur
 *      individuel on the profit; an option for IS is recorded as a regime,
 *      CGI art. 206, 3 and art. 1655 sexies);
 *    - EURL and SELARL with a single associé who is a natural person: IR
 *      unless it opted for IS (CGI art. 8, 4°); with a single associé that
 *      is a legal person: IS (CGI art. 206, 1); without a recorded associé:
 *      unknown, the user is asked to record the regime;
 *    - SARL, SAS, SASU, SA, SELAS, SCA: IS (CGI art. 206, 1); the option
 *      for IR (SARL de famille, CGI art. 239 bis AA; temporary option of
 *      art. 239 bis AB) is recorded as an income_tax regime;
 * 3. no legal form: unknown.
 */

export type ProfitTaxationKind = 'IS' | 'IR' | 'unknown'

/** Where the answer comes from: the recorded regime, the legal form, or nothing. */
export type ProfitTaxationBasis = 'regime' | 'legal-form' | 'none'

export interface ProfitTaxation {
  taxation: ProfitTaxationKind
  /** IR under the micro regime: no real charges deducted. */
  micro: boolean
  basis: ProfitTaxationBasis
  /** Plain French explanation, shown with the rules that depend on it. */
  explanation: string
}

export interface ProfitTaxationInput {
  legalType: string | null
  /** Corporate tax regime of the day: history row covering it, else Company.corporateTaxRegime. */
  regime: string | null
  /** Associés recorded for the company (Shareholder rows). */
  shareholders: ReadonlyArray<{ type: 'PHYSICAL' | 'LEGAL' }>
}

/** Value of a corporate tax regime that records an imposition at the impôt sur le revenu. */
export const INCOME_TAX_REGIME = 'income_tax'

/** Label of the regime values of type corporateTax, for the settings and messages. */
export const PROFIT_REGIME_LABELS: Record<string, string> = {
  normal: 'IS, régime normal',
  simplified: 'IS, régime simplifié',
  micro: 'Micro-entreprise (impôt sur le revenu)',
  [INCOME_TAX_REGIME]: 'Impôt sur le revenu (régime réel)',
}

const PARTNERSHIP_FORMS = new Set(['EI', 'SNC', 'SCS', 'SCI'])
const SINGLE_MEMBER_SARL_FORMS = new Set(['EURL', 'SELARL'])
const CAPITAL_FORMS = new Set(['SARL', 'SAS', 'SASU', 'SA', 'SELAS', 'SCA'])

export const SET_REGIME_HINT = 'Renseignez le régime d’imposition des bénéfices dans Informations de la société, Régimes fiscaux.'

export function profitTaxationOf(input: ProfitTaxationInput): ProfitTaxation {
  const regime = input.regime
  if (regime === 'normal' || regime === 'simplified') {
    return { taxation: 'IS', micro: false, basis: 'regime', explanation: `Société à l’impôt sur les sociétés (${PROFIT_REGIME_LABELS[regime]}), d’après ses régimes fiscaux.` }
  }
  if (regime === INCOME_TAX_REGIME) {
    return { taxation: 'IR', micro: false, basis: 'regime', explanation: 'Bénéfice imposé à l’impôt sur le revenu de l’exploitant ou des associés, d’après les régimes fiscaux de la société.' }
  }
  if (regime === 'micro') {
    return {
      taxation: 'IR',
      micro: true,
      basis: 'regime',
      explanation: 'Régime micro-entreprise : le bénéfice imposable est un abattement forfaitaire sur le chiffre d’affaires, les charges réelles ne sont pas déduites.',
    }
  }
  const form = input.legalType
  if (!form) return { taxation: 'unknown', micro: false, basis: 'none', explanation: `Forme juridique et régime d’imposition des bénéfices non renseignés. ${SET_REGIME_HINT}` }
  if (PARTNERSHIP_FORMS.has(form)) {
    return {
      taxation: 'IR',
      micro: false,
      basis: 'legal-form',
      explanation:
        form === 'EI'
          ? 'Entrepreneur individuel : bénéfice imposé à l’impôt sur le revenu (option pour l’IS à renseigner dans les régimes fiscaux le cas échéant).'
          : `${form} : bénéfice imposé à l’impôt sur le revenu des associés (CGI, art. 8), sauf option pour l’IS à renseigner dans les régimes fiscaux.`,
    }
  }
  if (SINGLE_MEMBER_SARL_FORMS.has(form)) {
    const [only, ...others] = input.shareholders
    if (only && others.length === 0) {
      return only.type === 'PHYSICAL'
        ? {
            taxation: 'IR',
            micro: false,
            basis: 'legal-form',
            explanation: `${form} dont l’associé unique est une personne physique : impôt sur le revenu par défaut (CGI, art. 8, 4°). Si la société a opté pour l’IS, renseignez-le dans les régimes fiscaux.`,
          }
        : { taxation: 'IS', micro: false, basis: 'legal-form', explanation: `${form} dont l’associé unique est une société : impôt sur les sociétés (CGI, art. 206, 1).` }
    }
    if (form === 'SELARL' && others.length > 0) {
      return { taxation: 'IS', micro: false, basis: 'legal-form', explanation: 'SELARL à plusieurs associés : impôt sur les sociétés (CGI, art. 206, 1).' }
    }
    return {
      taxation: 'unknown',
      micro: false,
      basis: 'none',
      explanation: `${form} : l’associé unique n’est pas renseigné, Kledg ne sait pas si le bénéfice est imposé à l’IR ou à l’IS. ${SET_REGIME_HINT}`,
    }
  }
  if (CAPITAL_FORMS.has(form)) {
    return {
      taxation: 'IS',
      micro: false,
      basis: 'legal-form',
      explanation: `${form} : impôt sur les sociétés par défaut (CGI, art. 206, 1). Si la société a opté pour l’impôt sur le revenu (SARL de famille, option temporaire), renseignez-le dans les régimes fiscaux.`,
    }
  }
  return { taxation: 'unknown', micro: false, basis: 'none', explanation: `Régime d’imposition des bénéfices non renseigné. ${SET_REGIME_HINT}` }
}

/** The corporate tax regime covering a day: the history row (company-wide) that covers it, else the company field. */
export function corporateTaxRegimeOn(
  day: string,
  history: ReadonlyArray<{ regime: string; startDate: string; endDate: string | null; establishmentId?: string | null }>,
  companyField: string | null,
): string | null {
  const row = history
    .filter((r) => !r.establishmentId && r.startDate <= day && (r.endDate === null || r.endDate >= day))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
  return row?.regime ?? companyField
}
