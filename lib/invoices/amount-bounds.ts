/**
 * Bounds of the amounts an invoice stores: every line total, VAT row and
 * total fits its Decimal(15, 2) column (MAX_AMOUNT_CENTS, lib/utils/money.ts),
 * checked before the write by the invoice service and the MCP dry run, so an
 * overflow is a French 400, never a database error.
 */

import { ValidationError } from '@/lib/accounting/errors'
import { amountTooLargeMessage, fitsAmountColumn } from '@/lib/utils/money'
import type { InvoiceTotals } from './amounts'

/**
 * Every amount an invoice stores (line totals, VAT breakdown, totals) fits
 * its Decimal(15, 2) column: a French 400 instead of a database error,
 * naming the first line beyond it.
 */
export function assertInvoiceAmountsFit(totals: InvoiceTotals): void {
  const lineIndex = totals.lineTotalsCents.findIndex((cents) => !fitsAmountColumn(cents))
  if (lineIndex >= 0) throw new ValidationError(`Ligne ${lineIndex + 1}\u00a0: ${amountTooLargeMessage()}.`)
  const amounts = [
    ...totals.breakdown.flatMap((row) => [row.baseCents, row.vatCents]),
    totals.totalExclTaxCents,
    totals.totalVatCents,
    totals.totalInclTaxCents,
  ]
  if (!amounts.every(fitsAmountColumn)) throw new ValidationError(`Total de la facture\u00a0: ${amountTooLargeMessage()}.`)
}
