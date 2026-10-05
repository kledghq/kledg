/**
 * The impôt sur les sociétés of a fiscal year, on plain values
 * (docs/impot-societes.md): from the accounting result to the tax result,
 * the deficits carried forward, the IS at 15 % and 25 %, the contribution
 * sociale and the credits. Pure: the loader gathers the figures, the tests
 * feed plain values.
 *
 * 1. Tax result (2033-B-SD lines 312 to 370, 2058-A-SD WA to XO): the
 *    accounting result of the income statement (closing entry excluded),
 *    plus the reintegrations, minus the deductions, rounded to the euro as
 *    the forms are filled.
 * 2. Deficits (CGI art. 209, I; BOI-IS-DEF-10-30): earlier deficits are
 *    deducted from a profit within 1 000 000 €, plus 50 % of the profit
 *    above; a loss adds to them.
 * 3. IS (CGI art. 219, I; BOI-IS-LIQ-20-10): 15 % up to 42 500 € (prorated
 *    for a fiscal year that is not of twelve months) when the company is
 *    eligible, 25 % on the rest. Eligibility: chiffre d'affaires of the
 *    year, ramené à douze mois, of 10 000 000 € at most, capital entièrement
 *    libéré, 75 % held by natural persons. An unanswered question computes
 *    at the normal rate (the figure is never lower than the tax) and says
 *    what the reduced rate would give.
 * 4. Contribution sociale (CGI art. 235 ter ZC): 3,3 % of the IS above
 *    763 000 € (prorated), unless the company is exempt (chiffre d'affaires
 *    under 7 630 000 €, same capital conditions).
 * 5. Credits d'impôt: manual lines, deducted from what is paid with the
 *    relevé de solde (2572-SD), never from the IS that serves as reference
 *    for the acomptes.
 */

import {
  annualize,
  applyRate,
  deficitCap,
  prorate,
  REDUCED_RATE_PROFIT_CEILING_CENTS,
  REDUCED_RATE_TURNOVER_CEILING_CENTS,
  roundToEuro,
  SOCIAL_CONTRIBUTION_ALLOWANCE_CENTS,
  SOCIAL_CONTRIBUTION_RATE_BP,
  SOCIAL_CONTRIBUTION_TURNOVER_CENTS,
  taxAtRates,
  type FiscalYearDuration,
} from './rules'
import type { CorporateTaxSourceKey } from './sources'

export type CorporateTaxRegime = 'normal' | 'simplified'

/** Where a line of the worksheet comes from. */
export type AdjustmentOrigin = 'books' | 'group' | 'manual'

/** A reintegration or a deduction of the tax result. Amounts positive. */
export interface Adjustment {
  id: string
  kind: 'reintegration' | 'deduction'
  origin: AdjustmentOrigin
  label: string
  amountCents: number
  /** Line of the 2033-B-SD (régime simplifié) and of the 2058-A-SD (régime normal), null when the form has no line of its own. */
  form: { simplified: string | null; normal: string | null }
  source: CorporateTaxSourceKey | null
  hint: string
}

export interface CreditLine {
  id: string
  label: string
  amountCents: number
}

export interface ComputeInput {
  regime: CorporateTaxRegime
  duration: FiscalYearDuration
  /** Result of the income statement of the year (after the 69 accounts), closing entry excluded. */
  accountingResultCents: number
  adjustments: Adjustment[]
  credits: CreditLine[]
  /** Deficits carried forward available at the start of the year; null when not known (computed as none). */
  deficitsOpeningCents: number | null
  /** Chiffre d'affaires of the year (comptes 70, credit minus debit), not annualized. */
  turnoverCents: number
  capitalPaidUp: boolean | null
  naturalPersons75: boolean | null
}

export interface WorksheetLine {
  id: string
  kind: 'result' | 'reintegration' | 'deduction' | 'subtotal' | 'deficits' | 'total'
  origin: AdjustmentOrigin | 'total'
  label: string
  /** Form line on the 2033-B-SD or 2058-A-SD of the company's regime. */
  formLine: string | null
  /** Signed for result lines (a loss is negative), positive for adjustments. */
  amountCents: number
  /** Whole euros to type on the form. */
  euros: number
  hint: string
  source: CorporateTaxSourceKey | null
}

export interface ReducedRateEligibility {
  /** True: every condition met; false: one is not; null: a question is not answered. */
  eligible: boolean | null
  turnoverAnnualCents: number
  turnoverOk: boolean
  capitalPaidUp: boolean | null
  naturalPersons75: boolean | null
}

export interface CorporateTaxComputation {
  regime: CorporateTaxRegime
  lines: WorksheetLine[]
  accountingResultCents: number
  /** Tax result before deficits, rounded to the euro (2033-B 352/354, 2058-A XI/XJ). */
  resultBeforeDeficitsCents: number
  deficits: {
    known: boolean
    openingCents: number
    /** Most that the profit could absorb (art. 209, I). */
    capCents: number
    imputedCents: number
    /** A loss of the year, carried forward. */
    createdCents: number
    closingCents: number
  }
  /** Taxable profit after deficits (2033-B 370, 2058-A XN), 0 for a loss. */
  taxableProfitCents: number
  eligibility: ReducedRateEligibility
  reducedRate: { applied: boolean; ceilingCents: number; baseCents: number; taxCents: number }
  normalRate: { baseCents: number; taxCents: number }
  /** IS at the rates of art. 219 (reference of the acomptes, before credits). */
  corporateTaxCents: number
  /** The IS if the reduced rate applied, when a question is unanswered: what answering yes would change. */
  ifEligibleCents: number | null
  socialContribution: { exempt: boolean; allowanceCents: number; baseCents: number; cents: number }
  creditsCents: number
  /** IS + contribution sociale - credits: the tax of the year before acomptes. */
  totalCents: number
}

const FORM_LINES = {
  result: { simplified: ['312', '314'], normal: ['WA', 'WS'] },
  beforeDeficits: { simplified: ['352', '354'], normal: ['XI', 'XJ'] },
  deficits: { simplified: '360', normal: 'XL' },
  taxable: { simplified: ['370', '372'], normal: ['XN', 'XO'] },
} as const

const euros = (cents: number) => Math.round(roundToEuro(cents) / 100)
const pick = (pair: readonly [string, string], negative: boolean) => (negative ? pair[1] : pair[0])

export function eligibilityOf(input: Pick<ComputeInput, 'turnoverCents' | 'duration' | 'capitalPaidUp' | 'naturalPersons75'>): ReducedRateEligibility {
  const turnoverAnnualCents = annualize(Math.max(input.turnoverCents, 0), input.duration)
  const turnoverOk = turnoverAnnualCents <= REDUCED_RATE_TURNOVER_CEILING_CENTS
  const answers = [input.capitalPaidUp, input.naturalPersons75]
  const eligible = !turnoverOk || answers.includes(false) ? false : answers.includes(null) ? null : true
  return { eligible, turnoverAnnualCents, turnoverOk, capitalPaidUp: input.capitalPaidUp, naturalPersons75: input.naturalPersons75 }
}

export function computeCorporateTax(input: ComputeInput): CorporateTaxComputation {
  const regime = input.regime
  const reintegrations = input.adjustments.filter((a) => a.kind === 'reintegration' && a.amountCents !== 0)
  const deductions = input.adjustments.filter((a) => a.kind === 'deduction' && a.amountCents !== 0)
  const sum = (list: Adjustment[]) => list.reduce((s, a) => s + a.amountCents, 0)

  // 1. Tax result, in whole euros as declared.
  const rawResult = input.accountingResultCents + sum(reintegrations) - sum(deductions)
  const resultBeforeDeficitsCents = roundToEuro(rawResult)

  // 2. Deficits (art. 209, I).
  const known = input.deficitsOpeningCents !== null
  const openingCents = roundToEuro(Math.max(input.deficitsOpeningCents ?? 0, 0))
  const capCents = deficitCap(resultBeforeDeficitsCents)
  const imputedCents = Math.min(openingCents, capCents)
  const createdCents = resultBeforeDeficitsCents < 0 ? -resultBeforeDeficitsCents : 0
  const closingCents = openingCents - imputedCents + createdCents
  const taxableProfitCents = Math.max(resultBeforeDeficitsCents - imputedCents, 0)

  // 3. IS at 15 % and 25 % (art. 219, I).
  const eligibility = eligibilityOf(input)
  const ceilingCents = roundToEuro(prorate(REDUCED_RATE_PROFIT_CEILING_CENTS, input.duration))
  const applied = eligibility.eligible === true
  const tax = taxAtRates(taxableProfitCents, applied, ceilingCents)
  const ifEligibleCents = eligibility.eligible === null ? taxAtRates(taxableProfitCents, true, ceilingCents).taxCents : null

  // 4. Contribution sociale (art. 235 ter ZC).
  const exempt =
    eligibility.turnoverAnnualCents < SOCIAL_CONTRIBUTION_TURNOVER_CENTS && input.capitalPaidUp === true && input.naturalPersons75 === true
  const allowanceCents = prorate(SOCIAL_CONTRIBUTION_ALLOWANCE_CENTS, input.duration)
  const socialBaseCents = exempt ? 0 : Math.max(tax.taxCents - allowanceCents, 0)
  const socialCents = applyRate(socialBaseCents, SOCIAL_CONTRIBUTION_RATE_BP)

  // 5. Credits.
  const creditsCents = input.credits.reduce((s, c) => s + Math.max(c.amountCents, 0), 0)

  const negative = resultBeforeDeficitsCents < 0
  const resultLoss = input.accountingResultCents < 0
  const adjustmentLine = (a: Adjustment): WorksheetLine => ({
    id: a.id,
    kind: a.kind,
    origin: a.origin,
    label: a.label,
    formLine: a.form[regime],
    amountCents: a.amountCents,
    euros: euros(a.amountCents),
    hint: a.hint,
    source: a.source,
  })
  const lines: WorksheetLine[] = [
    {
      id: 'result',
      kind: 'result',
      origin: 'books',
      label: resultLoss ? 'Perte comptable de l’exercice' : 'Bénéfice comptable de l’exercice',
      formLine: pick(FORM_LINES.result[regime], resultLoss),
      amountCents: input.accountingResultCents,
      euros: euros(input.accountingResultCents),
      hint: 'Résultat du compte de résultat, écritures validées, hors écriture de clôture.',
      source: null,
    },
    ...reintegrations.map(adjustmentLine),
    ...deductions.map(adjustmentLine),
    {
      id: 'before-deficits',
      kind: 'subtotal',
      origin: 'total',
      label: negative ? 'Déficit avant imputation des déficits antérieurs' : 'Bénéfice avant imputation des déficits antérieurs',
      formLine: pick(FORM_LINES.beforeDeficits[regime], negative),
      amountCents: resultBeforeDeficitsCents,
      euros: euros(resultBeforeDeficitsCents),
      hint: 'Résultat comptable, plus les réintégrations, moins les déductions, arrondi à l’euro.',
      source: null,
    },
    {
      id: 'deficits',
      kind: 'deficits',
      origin: known ? 'manual' : 'total',
      label: 'Déficits antérieurs imputés',
      formLine: FORM_LINES.deficits[regime],
      amountCents: imputedCents,
      euros: euros(imputedCents),
      hint: known
        ? `Déficits reportables au début de l’exercice : ${euros(openingCents)} €. Imputation limitée à 1 000 000 €, majorés de 50 % du bénéfice au-delà.`
        : 'Déficits reportables au début de l’exercice non renseignés : comptés à zéro.',
      source: 'cgi209',
    },
    {
      id: 'taxable',
      kind: 'total',
      origin: 'total',
      label: negative ? 'Déficit reportable en avant' : 'Résultat fiscal (bénéfice imposable)',
      formLine: pick(FORM_LINES.taxable[regime], negative),
      amountCents: negative ? resultBeforeDeficitsCents : taxableProfitCents,
      euros: euros(negative ? resultBeforeDeficitsCents : taxableProfitCents),
      hint: negative ? 'La perte s’ajoute aux déficits reportables des exercices suivants.' : 'Base de l’impôt sur les sociétés.',
      source: null,
    },
  ]

  return {
    regime,
    lines,
    accountingResultCents: input.accountingResultCents,
    resultBeforeDeficitsCents,
    deficits: { known, openingCents, capCents, imputedCents, createdCents, closingCents },
    taxableProfitCents,
    eligibility,
    reducedRate: { applied, ceilingCents, baseCents: tax.reducedBaseCents, taxCents: tax.reducedTaxCents },
    normalRate: { baseCents: tax.normalBaseCents, taxCents: tax.normalTaxCents },
    corporateTaxCents: tax.taxCents,
    ifEligibleCents,
    socialContribution: { exempt, allowanceCents, baseCents: socialBaseCents, cents: socialCents },
    creditsCents,
    totalCents: tax.taxCents + socialCents - creditsCents,
  }
}
