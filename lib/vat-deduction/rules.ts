/**
 * The coefficient de déduction of a company that makes taxable and exempt
 * operations (an organisme de formation whose training is exempt under CGI
 * art. 261, 4, 4° a and that sells other, taxed services). Pure: plain
 * values in cents and whole percents.
 *
 * - The VAT of a good or service is deductible "à proportion de son
 *   coefficient de déduction" (CGI ann. II art. 205), the product of the
 *   coefficients d'assujettissement, de taxation and d'admission
 *   (art. 206, I).
 * - Coefficient de taxation of a mixed use (art. 206, III, 3;
 *   BOI-TVA-DED-20-10-20 §50): turnover of the operations that open a right
 *   to deduct over the turnover of all the operations within the scope of
 *   VAT, of the calendar year, excluding tax. Exempt training sales are in
 *   the denominator only (§100); fixed asset disposals, débours,
 *   non-taxable subsidies and accessory financial operations are in neither
 *   (§150).
 * - Rounding: "Les quatre coefficients mentionnés au I sont arrondis par
 *   excès à la deuxième décimale" (art. 206, V, 2): each factor up to the
 *   next whole percent, then their product up again (BOI-TVA-DED-20-10-40
 *   §1: 0,5333 gives 0,54; 0,66 x 0,84 = 0,5544 gives 0,56).
 * - During year N the coefficient is provisional, from the turnover of the
 *   year before (BOI-TVA-DED-20-10-40, example 3); the definitive one,
 *   from the turnover of N, is set "avant le 25 avril de l'année suivante"
 *   (art. 206, V, 2) and the difference is regularised whatever its size
 *   (BOI-TVA-DED-20-10-20 §460): a complement of deduction on CA3 line 21
 *   (CA12 line 25), a reversement on CA3 line 15 (CA12 line 18) (notices of
 *   the 2026 forms).
 *
 * Kledg applies one coefficient to every expense of the company (the
 * coefficient d'admission stays per expense, lib/expense-reports/vat-recovery.ts):
 * an expense used only for taxed sales (coefficient de taxation 1) or only
 * for exempt ones (0), the distinct sectors of art. 209 and the yearly
 * regularisations of fixed assets over five or twenty years (art. 207, II)
 * are adjusted by hand (docs/organisme-de-formation.md).
 */

/** Ceiling of a / b in whole percent, 0 to 100; null when there is no denominator. Exact (BigInt). */
export function roundUpPercent(numeratorCents: number, denominatorCents: number): number | null {
  if (denominatorCents <= 0) return null
  const n = BigInt(Math.max(0, Math.min(numeratorCents, denominatorCents))) * BigInt(100)
  const d = BigInt(denominatorCents)
  return Number((n + d - BigInt(1)) / d)
}

/**
 * The coefficient de déduction from its factors in whole percents (each
 * already rounded up), their product rounded up to the whole percent
 * (art. 206, V, 2). Admission defaults to 100: Kledg applies it per expense.
 */
export function deductionPercent(assujettissementPercent: number, taxationPercent: number, admissionPercent = 100): number {
  const product = BigInt(assujettissementPercent) * BigInt(taxationPercent) * BigInt(admissionPercent)
  const scale = BigInt(10_000)
  return Number((product + scale - BigInt(1)) / scale)
}

/** n x percent / 100, rounded half away from zero (signed n and percent). */
export function percentOf(cents: number, percent: number): number {
  const sign = Math.sign(cents) * Math.sign(percent)
  const n = BigInt(Math.abs(cents)) * BigInt(Math.abs(percent)) * BigInt(2) + BigInt(100)
  return sign === 0 ? 0 : sign * Number(n / BigInt(200))
}

/**
 * The VAT borne in the year (before the coefficient) derived from the VAT
 * deducted under the provisional coefficient: deducted x 100 / provisional,
 * rounded half up. Null when nothing could be deducted (coefficient 0): the
 * user enters the VAT borne.
 */
export function incurredFromDeducted(deductedCents: number, provisionalPercent: number): number | null {
  if (provisionalPercent <= 0) return null
  if (provisionalPercent === 100) return deductedCents
  const n = BigInt(Math.max(deductedCents, 0)) * BigInt(200) + BigInt(provisionalPercent)
  return Number(n / BigInt(provisionalPercent * 2))
}

/**
 * The regularisation of a year: VAT borne x (definitive - provisional) /
 * 100. Positive: a complement of deduction; negative: VAT to pay back.
 * Due whatever its size (BOI-TVA-DED-20-10-20 §460).
 */
export function regularisationCents(incurredCents: number, provisionalPercent: number, definitivePercent: number): number {
  return percentOf(incurredCents, definitivePercent - provisionalPercent)
}

export type ProvisionalSource = 'previous-year' | 'estimate' | 'books-to-date'

/**
 * The provisional coefficient de taxation of a year: the definitive one of
 * the year before when that year had turnover (BOI-TVA-DED-20-10-40,
 * example 3), else the estimate the company entered. The texts give no rule
 * for a first year: without an estimate, Kledg shows the coefficient of the
 * year's books to date and asks for one (docs/organisme-de-formation.md).
 */
export function provisionalTaxation(input: {
  previousYearPercent: number | null
  estimatePercent: number | null
  yearToDatePercent: number | null
}): { percent: number; source: ProvisionalSource } {
  if (input.previousYearPercent !== null) return { percent: input.previousYearPercent, source: 'previous-year' }
  if (input.estimatePercent !== null) return { percent: input.estimatePercent, source: 'estimate' }
  return { percent: input.yearToDatePercent ?? 0, source: 'books-to-date' }
}

/** Last day to set the definitive coefficient of `year`: "avant le 25 avril de l'année suivante". */
export function regularisationDeadline(year: number): string {
  return `${year + 1}-04-24`
}

/** Reference of the regularisation draft of a year (not "TVA-": that prefix marks VAT settlements). */
export const regularisationReference = (year: number) => `COEF-TVA-${year}`
export const REGULARISATION_REFERENCE_PREFIX = 'COEF-TVA-'

/** The return line of a regularisation (notices 3310-CA3-SD and 3517-S-SD 2026). */
export function regularisationLine(form: 'CA3' | 'CA12', cents: number): { code: string; box: string; label: string } {
  if (cents >= 0) {
    return form === 'CA3'
      ? { code: '21', box: '0059', label: 'Autre TVA à déduire' }
      : { code: '25', box: '0059', label: 'Omissions ou compléments de déductions' }
  }
  return { code: form === 'CA3' ? '15' : '18', box: '0600', label: 'TVA antérieurement déduite à reverser' }
}

/** The line where the coefficient itself is written: 22A on the CA3, 25A on the CA12. */
export const COEFFICIENT_LINE = { CA3: '22A', CA12: '25A' } as const
