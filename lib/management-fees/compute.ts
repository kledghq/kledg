/**
 * The one pricing engine of management fees: from the cost pool (or the
 * fixed amount), the mark-up, the allocation key and the VAT rate, the fee of
 * each subsidiary for a period, in cents. The preview, the invoices and the
 * MCP tools all call it, so what the user sees is what is invoiced (one
 * computation, so the preview, the invoice and the accruals never disagree).
 *
 * Rounding (docs/conventions.md, Money):
 * 1. Cost plus: total HT = cost pool x service share x (1 + mark-up),
 *    rounded once, half away from zero; the base is the pool x service share
 *    rounded the same way and the mark-up is the difference, so base +
 *    mark-up = total exactly.
 * 2. The total is split by the key with allocateCents (lib/invoices/amounts.ts):
 *    each part rounded down, the remainder to the largest weight, so the
 *    parts sum to the total to the cent.
 * 3. VAT of each part is the VAT of its invoice: computeInvoiceTotals on one
 *    line (the base x rate, rounded half away from zero, CGI ann. II art. 242
 *    nonies A, I, 11°), so the preview equals the invoice Kledg records.
 *
 * Weights of the keys, for a subsidiary party to the convention for
 * `eligibleDays` of the period:
 * - EQUAL: eligibleDays (equal shares when every subsidiary is there all the period);
 * - CUSTOM: its percentage x eligibleDays;
 * - REVENUE: its revenue (class 70, validated entries) over its eligible days.
 * A subsidiary absent the whole period gets nothing; the amount is spread
 * over those present.
 */

import { ValidationError } from '@/lib/accounting/errors'
import { allocateCents, computeInvoiceTotals } from '@/lib/invoices/amounts'
import { isoDateToUtc, utcDaysInclusive } from '@/lib/utils/date'
import type { ManagementFeeAllocationKey, ManagementFeePricing } from './rules'

const BP = BigInt(10000)
const TWO = BigInt(2)
const ZERO = BigInt(0)

/** a x b / d rounded half away from zero (d > 0). */
function mulDivRounded(a: bigint, b: bigint, d: bigint): bigint {
  const n = a * b
  const negative = n < ZERO
  const abs = negative ? -n : n
  const q = (TWO * abs + d) / (TWO * d)
  return negative ? -q : q
}

export interface CostPlusAmounts {
  /** Pool x service share. */
  baseCents: number
  markupCents: number
  totalCents: number
}

/** Cost plus price of the pool: base and mark-up, each in cents, summing to the total (rule 1 above). */
export function costPlusAmounts(poolCents: number, costShareBp: number, markupBp: number): CostPlusAmounts {
  const pool = BigInt(poolCents)
  const baseCents = Number(mulDivRounded(pool, BigInt(costShareBp), BP))
  const totalCents = Number(mulDivRounded(pool * BigInt(costShareBp), BigInt(10000 + markupBp), BP * BP))
  return { baseCents, markupCents: totalCents - baseCents, totalCents }
}

export interface ComputeSubsidiary {
  subsidiaryId: string
  name: string
  /** CUSTOM key: share in basis points. */
  sharePercentBp: number | null
  /** Days of the period the subsidiary is party to the convention. */
  eligibleDays: number
  /** REVENUE key: its revenue over its eligible days, in cents; null for the other keys. */
  revenueCents: number | null
}

export interface ComputeInput {
  pricing: ManagementFeePricing
  markupBp: number
  costShareBp: number
  fixedAmountCents: number | null
  allocationKey: ManagementFeeAllocationKey
  vatRateBp: number
  /** Total of the pooled charge accounts over the period (cost plus only). */
  costPoolCents: number
  subsidiaries: readonly ComputeSubsidiary[]
}

export interface ComputedPart {
  subsidiaryId: string
  name: string
  eligibleDays: number
  revenueCents: number | null
  sharePercentBp: number | null
  /** Weight of the key, as a decimal string (it may exceed 2^53 for revenue x days in theory). */
  weight: string
  amountExclTaxCents: number
  vatCents: number
  amountInclTaxCents: number
}

export interface ComputeResult {
  pricing: ManagementFeePricing
  allocationKey: ManagementFeeAllocationKey
  costPoolCents: number
  costShareBp: number
  markupBp: number
  vatRateBp: number
  baseCents: number
  markupCents: number
  totalExclTaxCents: number
  totalVatCents: number
  totalInclTaxCents: number
  /** Every subsidiary of the convention, those absent the whole period with 0. */
  parts: ComputedPart[]
}

function weightOf(key: ManagementFeeAllocationKey, s: ComputeSubsidiary): number {
  if (s.eligibleDays <= 0) return 0
  if (key === 'EQUAL') return s.eligibleDays
  if (key === 'CUSTOM') return (s.sharePercentBp ?? 0) * s.eligibleDays
  return Math.max(s.revenueCents ?? 0, 0)
}

/** The fee of each subsidiary for one period. Throws a French 400 when there is nothing to invoice. */
export function computeManagementFees(input: ComputeInput): ComputeResult {
  if (input.subsidiaries.length === 0) throw new ValidationError('La convention ne compte aucune filiale.')
  let baseCents: number
  let markupCents: number
  let totalCents: number
  if (input.pricing === 'FIXED') {
    if (!input.fixedAmountCents || input.fixedAmountCents <= 0) throw new ValidationError('Indiquez le montant forfaitaire hors taxes de la période.')
    baseCents = input.fixedAmountCents
    markupCents = 0
    totalCents = input.fixedAmountCents
  } else {
    if (input.costPoolCents <= 0) {
      throw new ValidationError(
        'Les charges retenues de la holding sur la période sont nulles ou négatives : rien à refacturer. Vérifiez la période, les comptes retenus et que les écritures sont validées.',
      )
    }
    ;({ baseCents, markupCents, totalCents } = costPlusAmounts(input.costPoolCents, input.costShareBp, input.markupBp))
  }
  if (totalCents <= 0) throw new ValidationError('Le montant à refacturer est nul.')

  const weights = input.subsidiaries.map((s) => weightOf(input.allocationKey, s))
  if (weights.every((w) => w === 0)) {
    throw new ValidationError(
      input.allocationKey === 'REVENUE'
        ? 'Aucune filiale n’a de chiffre d’affaires validé (comptes 70) sur la période : la clé de répartition par chiffre d’affaires ne s’applique pas. Choisissez une autre clé ou une autre période.'
        : input.allocationKey === 'CUSTOM' && input.subsidiaries.some((s) => s.eligibleDays > 0)
          ? 'Les pourcentages des filiales présentes sur la période sont tous nuls.'
          : 'Aucune filiale n’est partie à la convention sur cette période.',
    )
  }
  const amounts = allocateCents(totalCents, weights)
  const parts = input.subsidiaries.map((s, i) => {
    const amount = amounts[i]
    const totals = amount > 0 ? computeInvoiceTotals([{ quantityThousandths: 1000, unitPriceCents: amount, vatRateBp: input.vatRateBp }]) : null
    return {
      subsidiaryId: s.subsidiaryId,
      name: s.name,
      eligibleDays: s.eligibleDays,
      revenueCents: s.revenueCents,
      sharePercentBp: s.sharePercentBp,
      weight: String(weights[i]),
      amountExclTaxCents: amount,
      vatCents: totals?.totalVatCents ?? 0,
      amountInclTaxCents: totals?.totalInclTaxCents ?? 0,
    }
  })
  const totalVatCents = parts.reduce((sum, p) => sum + p.vatCents, 0)
  return {
    pricing: input.pricing,
    allocationKey: input.allocationKey,
    costPoolCents: input.pricing === 'FIXED' ? 0 : input.costPoolCents,
    costShareBp: input.costShareBp,
    markupBp: input.pricing === 'FIXED' ? 0 : input.markupBp,
    vatRateBp: input.vatRateBp,
    baseCents,
    markupCents,
    totalExclTaxCents: totalCents,
    totalVatCents,
    totalInclTaxCents: totalCents + totalVatCents,
    parts,
  }
}

/** Days of [periodStart, periodEnd] (ISO days) within [from, to] (null: unbounded), both included. */
export function eligibleDays(periodStart: string, periodEnd: string, from: string | null, to: string | null): { days: number; start: string; end: string } {
  const start = from && from > periodStart ? from : periodStart
  const end = to && to < periodEnd ? to : periodEnd
  if (end < start) return { days: 0, start, end }
  return { days: utcDaysInclusive(isoDateToUtc(start), isoDateToUtc(end)), start, end }
}
