/**
 * Status and due date of an invoice, on plain values. Pure module (one
 * import, itself pure): the lists, the detail page and the services share it.
 *
 * Status is derived, never stored:
 * - brouillon: no entry yet (or its draft entry was deleted);
 * - comptabilisée: posted, nothing paid;
 * - payée partiellement: bank payments recorded on it cover part of it. Kledg
 *   has no partial lettering (docs/lettrage-et-tiers.md), so a part payment
 *   stays unlettered and the paid amount comes from the payments recorded;
 * - payée: its tiers line is lettered (with its payments, or by hand in
 *   Lettrage), or the payments recorded cover it (lettering then follows as
 *   soon as both entries are validated in the same fiscal year).
 */

import { dueDateOf, type PaymentTerms } from '@/lib/reports/third-parties/payment-terms'

export type InvoiceStatus = 'draft' | 'posted' | 'partially_paid' | 'paid'

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Brouillon',
  posted: 'Comptabilisée',
  partially_paid: 'Payée partiellement',
  paid: 'Payée',
}

export const INVOICE_STATUS_TONES: Record<InvoiceStatus, 'neutral' | 'info' | 'warning' | 'success'> = {
  draft: 'neutral',
  posted: 'info',
  partially_paid: 'warning',
  paid: 'success',
}

export interface StatusInput {
  posted: boolean
  totalInclTaxCents: number
  /** Sum of the payments recorded on the invoice. */
  paidCents: number
  /** The tiers line of its entry carries a lettering code. */
  lettered: boolean
}

export function invoiceStatus(input: StatusInput): InvoiceStatus {
  if (!input.posted) return 'draft'
  if (input.lettered || (input.totalInclTaxCents > 0 && input.paidCents >= input.totalInclTaxCents)) return 'paid'
  if (input.paidCents > 0) return 'partially_paid'
  return 'posted'
}

/** Amount still due, in cents (0 once lettered). */
export function remainingCents(input: Pick<StatusInput, 'totalInclTaxCents' | 'paidCents' | 'lettered'>): number {
  if (input.lettered) return 0
  return Math.max(0, input.totalInclTaxCents - input.paidCents)
}

/**
 * Latest due date the law allows for an invoice dated `issueDay`
 * (Code de commerce art. L441-10, I, al. 2): 60 days after the invoice, or
 * 45 days end of month when expressly agreed; the later of the two is the
 * cap Kledg accepts for a due date typed by hand.
 */
export function maxDueDate(issueDay: string): string {
  const sixty = dueDateOf(issueDay, { days: 60, endOfMonth: false })
  const endOfMonth = dueDateOf(issueDay, { days: 45, endOfMonth: true })
  return sixty > endOfMonth ? sixty : endOfMonth
}

/** Due date from the terms of the tiers, else those of the company. */
export function defaultDueDate(issueDay: string, terms: PaymentTerms): string {
  return dueDateOf(issueDay, terms)
}
