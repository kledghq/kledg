/**
 * Taxe sur les salaires (CGI art. 231, 1679, 1679 A; BOI-TPS-TS; notices
 * 2501-SD and 2502-SD). Pure: plain values, cents, whole percents.
 *
 * - Liability (art. 231, 1): employers not subject to VAT, or subject to it
 *   on less than 90 % of their turnover of the calendar year before the
 *   payment of the remunerations; employers whose turnover of that year is
 *   within the VAT franchise limits are not liable.
 * - Rapport d'assujettissement (art. 231, 1; BOI-TPS-TS-20-30): receipts
 *   that did not open a right to deduct VAT over all receipts, of the year
 *   before. It "peut être arrondi à l'unité inférieure" (§80): Kledg takes
 *   the whole percent below, the employer's option. Between 10 % and 20 %
 *   the notice gives a smoothing table (10 -> 0, 11 -> 2 ... 20 -> 20,
 *   §220), read here on the whole percent (the sources give only whole
 *   percent columns).
 * - Computation of the 2502 (notice, section C): each employee's annual
 *   base split between the brackets; bases summed across employees (A, A1,
 *   A2) and rounded to the euro; 4,25 % of A, 4,25 % more of A1 and 9,35 %
 *   more of A2 (rates of 4,25 %, 8,50 % and 13,60 %), each rounded to the
 *   euro; the rapport applied to their total; then franchise (1 200 € or
 *   less: nothing due) and décote (up to 2 040 €: 3/4 of the difference,
 *   art. 1679); then the abattement of associations (art. 1679 A), "après
 *   les mesures d'allègement" (notice 2502, C.4), never refunded.
 * - Payment (ann. III art. 369; notice 2501): monthly when the tax of the
 *   year before exceeded 10 000 €, quarterly from 4 000 € to 10 000 €,
 *   annually below; no relevé for December or the fourth quarter, paid with
 *   the 2502 by 15 January of the following year (31 January admitted,
 *   BOI-TPS-TS-40 §280).
 */

export interface PayrollTaxYearRules {
  /** Lower and upper thresholds of the annual individual remuneration, cents. */
  lowerCents: number
  upperCents: number
  /** Abattement of associations (art. 1679 A), cents. */
  associationAbatementCents: number
}

/** Values of the remunerations paid in each year (notices 2501-SD 2025 and 2026, art. 231, 2 bis, art. 1679 A). */
export const PAYROLL_TAX_YEARS: Record<number, PayrollTaxYearRules> = {
  2025: { lowerCents: 914_700, upperCents: 1_825_900, associationAbatementCents: 2_404_100 },
  2026: { lowerCents: 922_900, upperCents: 1_842_300, associationAbatementCents: 2_425_600 },
}

/** Rates in hundredths of a percent: 4,25 % on everything, 4,25 % more above the lower threshold, 9,35 % more above the upper one. */
export const RATE_BASE = 425
export const RATE_FIRST = 425
export const RATE_SECOND = 935
export const FRANCHISE_CENTS = 120_000
export const DECOTE_LIMIT_CENTS = 204_000
export const MONTHLY_ABOVE_CENTS = 1_000_000
export const QUARTERLY_FROM_CENTS = 400_000

/** Cents to the nearest euro, in cents (half up; amounts are never negative). */
export const roundEuro = (cents: number) => Math.floor((cents + 50) / 100) * 100

/** cents x rate (hundredths of a percent) / 10 000, exact then rounded to the euro. */
function taxOf(cents: number, rateHundredths: number): number {
  const exact = (BigInt(cents) * BigInt(rateHundredths) * BigInt(2) + BigInt(10_000)) / BigInt(20_000)
  return roundEuro(Number(exact))
}

/** The rapport in whole percent: truncated (BOI-TPS-TS-20-30 §80), then the smoothing table between 10 and 20 % (§220). */
export function appliedRatio(nonDeductibleCents: number, totalCents: number): { exactBasisPoints: number; truncatedPercent: number; appliedPercent: number } | null {
  if (totalCents <= 0) return null
  const bp = Number((BigInt(Math.min(Math.max(nonDeductibleCents, 0), totalCents)) * BigInt(10_000)) / BigInt(totalCents))
  const truncated = Math.floor(bp / 100)
  const applied = truncated < 10 ? 0 : truncated <= 20 ? (truncated - 10) * 2 : truncated
  return { exactBasisPoints: bp, truncatedPercent: truncated, appliedPercent: applied }
}

/** Liable when the turnover subject to VAT of the year before is under 90 %, i.e. the share without a right to deduct is above 10 %. */
export function isLiable(nonDeductibleCents: number, totalCents: number): boolean {
  return totalCents > 0 && BigInt(Math.max(nonDeductibleCents, 0)) * BigInt(10) > BigInt(totalCents)
}

/** Lines D0, D1, D2 and G of the 2502 from the bases A, A1 and A2 (rounded to the euro). */
export function lineTaxes(A: number, A1: number, A2: number): { d0: number; d1: number; d2: number; gross: number } {
  const d0 = taxOf(A, RATE_BASE)
  const d1 = taxOf(A1, RATE_FIRST)
  const d2 = taxOf(A2, RATE_SECOND)
  return { d0, d1, d2, gross: d0 + d1 + d2 }
}

export interface PayrollTaxComputation {
  /** Lines of the 2502, in cents rounded to the euro. */
  baseCents: number
  firstBracketCents: number
  secondBracketCents: number
  taxBaseCents: number
  taxFirstCents: number
  taxSecondCents: number
  grossCents: number
  ratioPercent: number
  afterRatioCents: number
  franchise: boolean
  decoteCents: number
  afterDecoteCents: number
  abatementCents: number
  dueCents: number
}

export function computePayrollTax(input: { rules: PayrollTaxYearRules; employeeBasesCents: readonly number[]; ratioPercent: number; association: boolean }): PayrollTaxComputation {
  const { lowerCents, upperCents } = input.rules
  let base = 0
  let first = 0
  let second = 0
  for (const raw of input.employeeBasesCents) {
    const b = Math.max(raw, 0)
    base += b
    first += Math.max(Math.min(b, upperCents) - lowerCents, 0)
    second += Math.max(b - upperCents, 0)
  }
  const A = roundEuro(base)
  const A1 = roundEuro(first)
  const A2 = roundEuro(second)
  const { d0, d1, d2, gross } = lineTaxes(A, A1, A2)
  const afterRatio = roundEuro(Math.floor((gross * input.ratioPercent * 2 + 100) / 200))
  const franchise = afterRatio <= FRANCHISE_CENTS
  const decote = franchise ? afterRatio : afterRatio < DECOTE_LIMIT_CENTS ? roundEuro(Math.floor(((DECOTE_LIMIT_CENTS - afterRatio) * 3 * 2 + 4) / 8)) : 0
  const afterDecote = Math.max(afterRatio - decote, 0)
  const abatement = input.association ? Math.min(input.rules.associationAbatementCents, afterDecote) : 0
  return {
    baseCents: A,
    firstBracketCents: A1,
    secondBracketCents: A2,
    taxBaseCents: d0,
    taxFirstCents: d1,
    taxSecondCents: d2,
    grossCents: gross,
    ratioPercent: input.ratioPercent,
    afterRatioCents: afterRatio,
    franchise,
    decoteCents: decote,
    afterDecoteCents: afterDecote,
    abatementCents: abatement,
    dueCents: afterDecote - abatement,
  }
}

export type PayrollTaxFrequency = 'monthly' | 'quarterly' | 'annual'

/** Frequency of the relevés 2501 of a year from the tax of the year before (ann. III art. 369, notice 2501). */
export function frequencyOf(previousYearTaxCents: number): PayrollTaxFrequency {
  if (previousYearTaxCents > MONTHLY_ABOVE_CENTS) return 'monthly'
  if (previousYearTaxCents >= QUARTERLY_FROM_CENTS) return 'quarterly'
  return 'annual'
}

/** Days of the relevés 2501 of a year ("dans les quinze premiers jours" of the next month or quarter; none for December or Q4). */
export function releveDates(year: number, frequency: PayrollTaxFrequency): Array<{ key: string; period: string; date: string }> {
  const pad = (n: number) => String(n).padStart(2, '0')
  if (frequency === 'monthly') return Array.from({ length: 11 }, (_, i) => ({ key: `${year}-${pad(i + 1)}`, period: `${year}-${pad(i + 1)}`, date: `${year}-${pad(i + 2)}-15` }))
  if (frequency === 'quarterly') return [1, 2, 3].map((q) => ({ key: `${year}-T${q}`, period: `${year}-T${q}`, date: `${year}-${pad(q * 3 + 1)}-15` }))
  return []
}

/** The annual declaration 2502 of the remunerations of `year`: 15 January of the following year, 31 January admitted. */
export function annualDeclarationDate(year: number): { date: string; extendedDate: string } {
  return { date: `${year + 1}-01-15`, extendedDate: `${year + 1}-01-31` }
}

export const payrollTaxReference = (year: number) => `TS-${year}`
