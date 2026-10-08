/** Types shared by the reconciliation API and the dialog (no server imports). */

import type { BankSide, FiscalYearPeriod } from './validation'

export interface SuggestedLine {
  accountCode: string
  accountLabel: string
  debitCents: number
  creditCents: number
  description: string | null
}

export interface Suggestion {
  source: 'rule' | 'history'
  /** French explanation shown above the lines. */
  title: string
  ruleId?: string
  /** The transaction it was copied from (history). */
  fromTransactionId?: string
  /** VAT rate of the suggested lines (percent), null without VAT. */
  vatRatePercent: number | null
  lines: SuggestedLine[]
}

/** GET /api/transactions/[id]/reconcile */
export interface ReconciliationContext {
  transaction: {
    id: string
    /** ISO date (yyyy-mm-dd). */
    date: string
    amountCents: number
    side: BankSide
    label: string | null
    reference: string | null
    counterpartyName: string | null
    reconciled: boolean
    reconciledWith: string | null
    vatRatePercent: number | null
    vatAmountCents: number | null
    /**
     * Share (0 to 1) of its deductible VAT the company recovers on the day of
     * the transaction (coefficient de déduction, lib/vat-deduction/coefficient.ts);
     * null: all of it. The self-assessed templates deduct this share (share.ts).
     */
    vatDeductionShare?: number | null
  }
  bankLine: { debitCents: number; creditCents: number }
  /** Account of the locked bank line (in the fiscal year of the transaction date), null when missing. */
  bankAccount: { code: string; label: string } | null
  fiscalYears: FiscalYearPeriod[]
  /** Fiscal year of the transaction date, when there is one. */
  fiscalYearId: string | null
  suggestion: Suggestion | null
}
