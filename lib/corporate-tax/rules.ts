/**
 * Rates, thresholds and durations of the impôt sur les sociétés
 * (docs/impot-societes.md). Pure, no imports: usable on both sides.
 *
 * - CGI art. 219, I: normal rate 25 %; reduced rate 15 % on the first
 *   42 500 € of taxable profit "par période de douze mois", for a company
 *   whose chiffre d'affaires, "ramené s'il y a lieu à douze mois", does not
 *   exceed 10 000 000 € ("n'excédant pas"), whose capital is entièrement
 *   libéré and held for 75 % at least by natural persons (directly, or
 *   through companies meeting the same conditions). BOI-IS-LIQ-20-10.
 * - CGI art. 235 ter ZC: contribution sociale of 3,3 % on the IS minus an
 *   allowance of 763 000 € per twelve months; companies with a chiffre
 *   d'affaires under 7 630 000 € (twelve months) meeting the same capital
 *   conditions are exempt.
 * - CGI art. 209, I: earlier deficits are deducted within 1 000 000 €,
 *   plus 50 % of the profit above that amount (per exercice, not
 *   prorated).
 * - CGI art. 1668 and BOI-IS-DECLA-20-10 § 360: no acompte when the IS of
 *   the reference profit does not exceed 3 000 €.
 * - CGI art. 145 and 216: parent-subsidiary regime from 5 % of the capital,
 *   quote-part de frais et charges of 5 % of the dividends.
 *
 * Amounts in cents; rates in basis points (2 500 = 25 %); stakes in basis
 * points of a percent (500 = 5 %), as lib/group reads them.
 */

export const NORMAL_RATE_BP = 2_500
export const REDUCED_RATE_BP = 1_500
export const REDUCED_RATE_PROFIT_CEILING_CENTS = 4_250_000
export const REDUCED_RATE_TURNOVER_CEILING_CENTS = 1_000_000_000
export const SOCIAL_CONTRIBUTION_RATE_BP = 330
export const SOCIAL_CONTRIBUTION_ALLOWANCE_CENTS = 76_300_000
export const SOCIAL_CONTRIBUTION_TURNOVER_CENTS = 763_000_000
export const DEFICIT_CAP_BASE_CENTS = 100_000_000
export const DEFICIT_CAP_EXCESS_SHARE_BP = 5_000
export const ACOMPTE_EXEMPTION_CENTS = 300_000
export const PARENT_SUBSIDIARY_MIN_STAKE_BP = 500
export const PARENT_QUOTE_PART_BP = 500

const DAY_MS = 86_400_000

/** Length of a fiscal year: whole calendar months when it runs from a 1st to a month end, and its days. */
export interface FiscalYearDuration {
  months: number | null
  days: number
}

const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function durationOf(start: string, end: string): FiscalYearDuration {
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const whole = sd === 1 && ed === lastDayOfMonth(ey, em)
  return { months: whole ? (ey - sy) * 12 + (em - sm) + 1 : null, days }
}

/** Whether the duration is exactly twelve months (nothing to prorate). */
export function isTwelveMonths(duration: FiscalYearDuration): boolean {
  return duration.months === 12
}

/** a x b / c rounded half away from zero, exact for any amount of the Decimal(15, 2) columns. */
export function mulDivRound(a: number, b: number, c: number): number {
  const n = BigInt(a) * BigInt(b)
  const d = BigInt(c)
  const negative = n < BigInt(0) !== d < BigInt(0)
  const absN = n < BigInt(0) ? -n : n
  const absD = d < BigInt(0) ? -d : d
  const q = (absN * BigInt(2) + absD) / (absD * BigInt(2))
  return Number(negative ? -q : q)
}

/**
 * An amount "par période de douze mois" for a fiscal year of another
 * length, prorata temporis: by months when the year is made of whole
 * months, else by days over 365.
 */
export function prorate(cents: number, duration: FiscalYearDuration): number {
  if (duration.months !== null) return mulDivRound(cents, duration.months, 12)
  return mulDivRound(cents, duration.days, 365)
}

/** An amount of the year "ramené à douze mois" (chiffre d'affaires, profit of reference). */
export function annualize(cents: number, duration: FiscalYearDuration): number {
  if (duration.months !== null) return mulDivRound(cents, 12, duration.months)
  return mulDivRound(cents, 365, duration.days)
}

/** Rounded to the euro, 0,50 € and more counting for one (the forms are filled in whole euros). */
export function roundToEuro(cents: number): number {
  return mulDivRound(cents, 1, 100) * 100
}

/** A rate in basis points applied to an amount, rounded to the cent. */
export function applyRate(cents: number, rateBp: number): number {
  return mulDivRound(cents, rateBp, 10_000)
}

/**
 * Deficits a profit may absorb (CGI art. 209, I): the whole profit up to
 * 1 000 000 €, plus 50 % of the profit above. Not prorated for a short or
 * long exercice (the article sets a limit per exercice).
 */
export function deficitCap(profitCents: number): number {
  if (profitCents <= 0) return 0
  if (profitCents <= DEFICIT_CAP_BASE_CENTS) return profitCents
  return DEFICIT_CAP_BASE_CENTS + mulDivRound(profitCents - DEFICIT_CAP_BASE_CENTS, DEFICIT_CAP_EXCESS_SHARE_BP, 10_000)
}

/** IS at the rates of art. 219, I on a taxable profit, with the reduced rate up to `ceilingCents` when eligible. */
export function taxAtRates(profitCents: number, reducedRate: boolean, ceilingCents: number): { reducedBaseCents: number; normalBaseCents: number; reducedTaxCents: number; normalTaxCents: number; taxCents: number } {
  const profit = Math.max(profitCents, 0)
  const reducedBaseCents = reducedRate ? Math.min(profit, ceilingCents) : 0
  const normalBaseCents = profit - reducedBaseCents
  const reducedTaxCents = applyRate(reducedBaseCents, REDUCED_RATE_BP)
  const normalTaxCents = applyRate(normalBaseCents, NORMAL_RATE_BP)
  return { reducedBaseCents, normalBaseCents, reducedTaxCents, normalTaxCents, taxCents: reducedTaxCents + normalTaxCents }
}
