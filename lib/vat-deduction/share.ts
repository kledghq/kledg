/**
 * The part of a VAT a company deducts, for every posting Kledg prepares
 * (assignment rules and their simulation, simple mode, the reconciliation
 * templates). Pure, in integer cents (the browser imports it).
 *
 * - A partly exempt company deducts its VAT "à proportion de son
 *   coefficient de déduction" (CGI ann. II art. 205): coefficient x VAT,
 *   rounded half up to the cent as lib/invoices/posting-plan.ts does; the
 *   rest is part of the cost of what it bought.
 * - Self-assessed VAT (autoliquidation: services of a supplier not
 *   established in France, CGI art. 283, 2; intra-Community acquisitions,
 *   art. 256 bis; purchases of art. 283, 1; imports) is due in full by the
 *   company (4452 or 44571, 100 %), and deducted like any other VAT it
 *   bears: coefficient x VAT on 44566 (or 44562), the rest in the charge.
 *   A franchise owes it and deducts none (share 0).
 *
 * Worked example: 1 000 € of services from a US supplier, 20 %
 * self-assessed, coefficient 60 %: 200 € due on 4452, 120 € deducted on
 * 44566, 80 € added to the charge (1 080 €); the entry still sums to the
 * 1 000 € paid.
 */

/** Share (0 to 1) as millionths: the coefficients are whole percents or ratios of cent sums. */
function millionthsOf(share: number): number {
  return Math.round(Math.min(Math.max(share, 0), 1) * 1_000_000)
}

/** The VAT deducted out of `vatCents` (>= 0) at `share` (0 to 1), half up; null share: all of it. */
export function deductibleVatCents(vatCents: number, share: number | null): number {
  if (share === null || vatCents <= 0) return Math.max(vatCents, 0)
  return Math.floor((vatCents * millionthsOf(share) * 2 + 1_000_000) / 2_000_000)
}

export interface SelfAssessedSplit {
  /** VAT due by the company: always the whole VAT (4452, or 44571 for an import). */
  dueCents: number
  /** Part deducted (44566 or 44562). */
  deductibleCents: number
  /** Part not deducted, added to the charge or the asset. */
  nonDeductibleCents: number
}

/** The lines of a self-assessed VAT of `vatCents` for a company deducting `share` (null: all of it). */
export function selfAssessedSplit(vatCents: number, share: number | null): SelfAssessedSplit {
  const due = Math.max(vatCents, 0)
  const deductible = deductibleVatCents(due, share)
  return { dueCents: due, deductibleCents: deductible, nonDeductibleCents: due - deductible }
}
