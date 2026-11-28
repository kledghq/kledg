/**
 * The prefill of a receipt's form: what Kledg read in the file
 * (read-receipt.ts), completed by its file name (file-name-fields.ts).
 * Pure module, without imports at run time (client side).
 */

import type { FileNameFields } from '../file-name-fields'

/** Where the prefill comes from: an e-invoice's data, a PDF's text, the file name. */
export type ReceiptReadFrom = 'e-invoice' | 'pdf' | 'file-name'

export interface ReceiptGuess extends FileNameFields {
  currency: string | null
  /** VAT per rate, cents; only an e-invoice gives it. */
  vatLines: Array<{ rateBp: number; amountCents: number }>
  /** Where the amount and the date come from; null when nothing was read. */
  readFrom: ReceiptReadFrom | null
}

interface ContentFields {
  amountCents: number | null
  currency: string | null
  date: string | null
  merchant: string | null
  vatLines: Array<{ rateBp: number; amountCents: number }>
  readFrom: Exclude<ReceiptReadFrom, 'file-name'>
}

/** The file's content first (what its issuer wrote), its name for what the content does not say. */
export function mergeGuess(content: ContentFields | null, fromName: FileNameFields): ReceiptGuess {
  const amountCents = content?.amountCents ?? fromName.amountCents
  const date = content?.date ?? fromName.date
  const fromContent = content !== null && (content.amountCents !== null || content.date !== null)
  const fromFileName = !fromContent && (fromName.amountCents !== null || fromName.date !== null || fromName.merchant !== null)
  return {
    amountCents,
    date,
    merchant: content?.merchant ?? fromName.merchant,
    currency: content?.amountCents != null ? content.currency : null,
    vatLines: content?.vatLines ?? [],
    readFrom: fromContent ? content.readFrom : fromFileName ? 'file-name' : null,
  }
}
