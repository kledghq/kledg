/**
 * Invoice amounts in integer cents. Pure module without imports: the invoice
 * form (live totals) and the server (stored totals, posting) run the same
 * code, so what the user sees is what Kledg records.
 *
 * Rounding rule (documented in docs/factures-et-tiers.md):
 * 1. Line: total excluding tax = quantity x unit price, rounded to the cent,
 *    half away from zero ("arrondi commercial"). Quantities carry three
 *    decimals at most, unit prices two (cents).
 * 2. VAT is computed per rate, on the sum of the line totals at that rate,
 *    rounded to the cent the same way; never line by line. CGI ann. II
 *    art. 242 nonies A, I, 11° requires "par taux d'imposition, le total
 *    hors taxe et la taxe correspondante": the breakdown per rate is the
 *    legal amount, and rounding it once per rate keeps the VAT of the
 *    document equal to rate x base. It is also the rule of EN 16931
 *    (BR-CO-17: VAT category tax amount = taxable amount x rate, rounded to
 *    two decimals), so a Factur-X, UBL or CII invoice imported later agrees.
 * 3. Total including tax = sum of the bases + sum of the VAT amounts.
 *
 * Rates are integer basis points (2000 = 20 %, 550 = 5,5 %): no float ever
 * touches an amount.
 */

/** VAT rates of French law, in basis points (CGI art. 278 to 281 nonies, 296 for overseas, 297 for Corsica). */
export const FRENCH_VAT_RATES_BP = [2000, 1300, 1000, 850, 550, 210, 175, 105, 90, 0] as const

/** Rates offered first in the forms: the mainland rates. */
export const COMMON_VAT_RATES_BP = [2000, 1000, 550, 210, 0] as const

export function isFrenchVatRate(rateBp: number): boolean {
  return (FRENCH_VAT_RATES_BP as readonly number[]).includes(rateBp)
}

/** "20 %", "5,5 %", "0 %" (narrow no-break space before %). */
export function formatVatRate(rateBp: number): string {
  const whole = Math.trunc(rateBp / 100)
  const decimals = String(rateBp % 100).padStart(2, '0').replace(/0+$/, '')
  return `${whole}${decimals ? `,${decimals}` : ''} %`
}

const ZERO = BigInt(0)
const TWO = BigInt(2)

/** n / d rounded half away from zero, d > 0. */
function divideRounded(n: bigint, d: bigint): bigint {
  const negative = n < ZERO
  const abs = negative ? -n : n
  const q = (TWO * abs + d) / (TWO * d)
  return negative ? -q : q
}

/**
 * Thousandths of a quantity typed as "2", "1,5", "0.125" or a number with
 * three decimals at most; null when it is not one.
 */
export function parseQuantity(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const text = (typeof value === 'number' ? String(value) : value).trim().replace(/[\s  ]/g, '').replace(',', '.')
  const match = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(text)
  if (!match) return null
  return Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'))
}

/** A quantity in thousandths written as a decimal string ("1.5", "2"). */
export function quantityToString(thousandths: number): string {
  const whole = Math.trunc(thousandths / 1000)
  const decimals = String(thousandths % 1000).padStart(3, '0').replace(/0+$/, '')
  return decimals ? `${whole}.${decimals}` : String(whole)
}

/**
 * Basis points of a rate given as a fraction ("0.2", "0.055", Qonto client
 * invoices) or as a percentage ("20", "5.5", Qonto supplier invoices);
 * null when it is not a whole number of basis points between 0 and 100 %.
 */
export function rateToBasisPoints(value: string | number | null | undefined, unit: 'fraction' | 'percent'): number | null {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim().replace(',', '.')
  const match = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(text)
  if (!match) return null
  const shift = unit === 'fraction' ? 4 : 2
  const decimals = (match[2] ?? '').padEnd(6, '0')
  const scaled = Number(match[1]) * 10 ** shift + Number(decimals.slice(0, shift))
  if (Number(decimals.slice(shift)) !== 0) return null
  return scaled <= 10000 ? scaled : null
}

/** Line total excluding tax in cents: quantity (thousandths) x unit price (cents), rounded half away from zero. */
export function lineTotalCents(quantityThousandths: number, unitPriceCents: number): number {
  return Number(divideRounded(BigInt(quantityThousandths) * BigInt(unitPriceCents), BigInt(1000)))
}

/** VAT in cents on a base at a rate (basis points), rounded half away from zero. */
export function vatOnBaseCents(baseCents: number, rateBp: number): number {
  return Number(divideRounded(BigInt(baseCents) * BigInt(rateBp), BigInt(10000)))
}

export interface AmountLine {
  quantityThousandths: number
  unitPriceCents: number
  vatRateBp: number
}

export interface VatBreakdownRow {
  vatRateBp: number
  baseCents: number
  vatCents: number
}

export interface InvoiceTotals {
  /** Total excluding tax of each line, in the order given. */
  lineTotalsCents: number[]
  /** One row per rate, highest rate first. */
  breakdown: VatBreakdownRow[]
  totalExclTaxCents: number
  totalVatCents: number
  totalInclTaxCents: number
}

/** Totals of an invoice under the rounding rule of this module. */
export function computeInvoiceTotals(lines: readonly AmountLine[]): InvoiceTotals {
  const lineTotalsCents = lines.map((line) => lineTotalCents(line.quantityThousandths, line.unitPriceCents))
  const bases = new Map<number, number>()
  lines.forEach((line, index) => bases.set(line.vatRateBp, (bases.get(line.vatRateBp) ?? 0) + lineTotalsCents[index]))
  const breakdown = [...bases.entries()]
    .sort(([a], [b]) => b - a)
    .map(([vatRateBp, baseCents]) => ({ vatRateBp, baseCents, vatCents: vatOnBaseCents(baseCents, vatRateBp) }))
  return totalsOfBreakdown(lineTotalsCents, breakdown)
}

/** Totals from a breakdown taken as is (an imported document). */
export function totalsOfBreakdown(lineTotalsCents: number[], breakdown: VatBreakdownRow[]): InvoiceTotals {
  const totalExclTaxCents = breakdown.reduce((sum, row) => sum + row.baseCents, 0)
  const totalVatCents = breakdown.reduce((sum, row) => sum + row.vatCents, 0)
  return { lineTotalsCents, breakdown, totalExclTaxCents, totalVatCents, totalInclTaxCents: totalExclTaxCents + totalVatCents }
}

/**
 * Splits `totalCents` in parts proportional to `weights` (non-negative), in
 * cents. Each part is rounded down, then the remainder goes to the largest
 * weight (first one on a tie), so the parts always sum to the total
 * (docs/conventions.md, Money: allocation). All weights zero: everything to
 * the first part.
 */
export function allocateCents(totalCents: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return []
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum === 0) return weights.map((_, i) => (i === 0 ? totalCents : 0))
  const total = BigInt(totalCents)
  const parts = weights.map((w) => Number((total * BigInt(w)) / BigInt(sum)))
  const remainder = totalCents - parts.reduce((a, b) => a + b, 0)
  let largest = 0
  weights.forEach((w, i) => {
    if (w > weights[largest]) largest = i
  })
  parts[largest] += remainder
  return parts
}

/** Whether `a` and `b` (cents) differ by at most `tolerance` cents. */
export function withinCents(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance
}
