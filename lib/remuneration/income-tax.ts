/**
 * Income tax of the household (impôt sur le revenu), on plain values, for
 * the remuneration simulator (docs/remuneration-dividendes.md). Pure, no
 * imports but the rules.
 *
 * - CGI art. 197, I, 1: progressive scale per part of quotient familial
 *   (RULES.incomeTax.brackets), the tax of one part multiplied by the
 *   parts.
 * - CGI art. 197, I, 2: the advantage of the half parts above the base
 *   parts (1 for a single person, 2 for a couple taxed jointly) is capped
 *   per half part (plafonnement du quotient familial). The simulator takes
 *   the base parts from the parts typed: 2 when there are at least 2, else
 *   1 (a single parent's extra half part has its own cap, not modelled).
 * - CGI art. 197, I, 4: décote for a small tax.
 * - CGI art. 83, 3°: salaries (and, through art. 62, the pay of a majority
 *   gérant) after a 10 % deduction for professional expenses, within a
 *   minimum and a maximum per person.
 *
 * Not modelled: reductions and credits, the contribution exceptionnelle sur
 * les hauts revenus (CGI art. 223 sexies) and the différentielle of art.
 * 224, the single parent half part cap.
 */

import { RULES } from './rules'

/** a x b / c rounded half away from zero (BigInt, exact for any amount). */
export function mulDiv(a: number, b: number, c: number): number {
  const n = BigInt(a) * BigInt(b)
  const d = BigInt(c)
  const negative = n < BigInt(0) !== d < BigInt(0)
  const absN = n < BigInt(0) ? -n : n
  const absD = d < BigInt(0) ? -d : d
  const q = (absN * BigInt(2) + absD) / (absD * BigInt(2))
  return Number(negative ? -q : q)
}

/** A rate in basis points of an amount, rounded to the cent. */
export const rate = (cents: number, bp: number) => mulDiv(cents, bp, 10_000)

/** Taxable salary after the 10 % deduction for professional expenses (CGI art. 83, 3°), within its minimum and maximum. */
export function salaryAfterDeduction(taxableSalaryCents: number): number {
  if (taxableSalaryCents <= 0) return 0
  const { deductionBp, deductionMinCents, deductionMaxCents } = RULES.incomeTax
  const deduction = Math.min(Math.max(rate(taxableSalaryCents, deductionBp), deductionMinCents), deductionMaxCents)
  return Math.max(taxableSalaryCents - deduction, 0)
}

/** Tax of one part on an income per part, by the progressive scale (cents). */
function scaleTax(incomePerPartCents: number): number {
  let tax = 0
  for (const bracket of RULES.incomeTax.brackets) {
    if (incomePerPartCents <= bracket.fromCents) break
    const upper = bracket.toCents === null ? incomePerPartCents : Math.min(incomePerPartCents, bracket.toCents)
    tax += rate(upper - bracket.fromCents, bracket.rateBp)
  }
  return tax
}

/** Tax of a household by the scale, with `parts` parts, before the cap of the quotient familial. */
function taxWithParts(incomeCents: number, parts: number): number {
  const quarters = Math.round(parts * 4)
  const perPart = mulDiv(incomeCents, 4, quarters)
  return mulDiv(scaleTax(perPart), quarters, 4)
}

export interface IncomeTaxResult {
  /** Revenu net imposable, rounded down to the euro as the scale is applied. */
  taxableIncomeCents: number
  /** Tax by the scale with the cap of the quotient familial. */
  grossTaxCents: number
  decoteCents: number
  /** Tax due by the scale (before the PFU, which is added apart). */
  taxCents: number
  /** Highest rate of the scale reached per part, in basis points. */
  marginalRateBp: number
  capped: boolean
}

/** Income tax of a household with `parts` parts on its net taxable income (scale, quotient familial cap, décote). */
export function incomeTax(netTaxableIncomeCents: number, parts: number): IncomeTaxResult {
  const income = Math.max(Math.floor(netTaxableIncomeCents / 100) * 100, 0)
  const baseParts = parts >= 2 ? 2 : 1
  const full = taxWithParts(income, parts)
  const base = taxWithParts(income, baseParts)
  const halfParts = Math.round((parts - baseParts) * 2)
  const cap = base - halfParts * RULES.incomeTax.quotientCapPerHalfPartCents
  const capped = halfParts > 0 && cap > full
  const gross = capped ? cap : full
  const { decoteSingleCents, decoteCoupleCents, decoteBp } = RULES.incomeTax
  const threshold = baseParts === 2 ? decoteCoupleCents : decoteSingleCents
  // Décote (CGI art. 197, I, 4): 897 € (1 483 € for a couple) minus 45,25 % of the tax, so none from a tax of 1 982 € (3 277 €).
  const decote = gross > 0 ? Math.min(Math.max(threshold - rate(gross, decoteBp), 0), gross) : 0
  const perPart = mulDiv(income, 4, Math.round(parts * 4))
  const reached = RULES.incomeTax.brackets.filter((b) => perPart > b.fromCents)
  return {
    taxableIncomeCents: income,
    grossTaxCents: gross,
    decoteCents: Math.max(decote, 0),
    taxCents: Math.max(gross - Math.max(decote, 0), 0),
    marginalRateBp: reached.length ? reached[reached.length - 1].rateBp : 0,
    capped,
  }
}
