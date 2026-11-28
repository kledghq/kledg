/**
 * What Kledg reads in a receipt file, to prefill the form of the
 * Justificatifs page (docs/justificatifs-photo.md). Without a model and
 * without OCR:
 * 1. an e-invoice (Factur-X PDF, lib/invoices/e-invoice): its structured
 *    data, exact: the amount due (total VAT included less what was already
 *    paid, BT-112 and BT-113), the issue date, the seller, the VAT per rate;
 * 2. another PDF: its text layer (pdf-text.ts), read by invoice-text.ts,
 *    and the supplier named in it (a known vendor, else a supplier of the
 *    company);
 * 3. a photo: nothing (only its file name, file-name-fields.ts).
 * The user confirms what is read before the receipt is filed.
 */

import { parseEInvoice } from '@/lib/invoices/e-invoice/parse-e-invoice'
import { detectTiers, detectVendor, type TiersIndex } from '../detect-supplier'
import type { ReceiptVatLine } from '../stage-receipt.service'
import { readInvoiceText } from './invoice-text'
import { pdfTextLines } from './pdf-text'
import type { ReceiptReadFrom } from './guess'

export interface ReceiptReading {
  amountCents: number | null
  currency: string | null
  date: string | null
  merchant: string | null
  vatLines: ReceiptVatLine[]
  readFrom: Exclude<ReceiptReadFrom, 'file-name'>
}

/** What the file says, or null when Kledg cannot read it (a photo, a scan, an unreadable PDF). */
export async function readReceiptFile(bytes: Uint8Array, contentType: string, suppliers: TiersIndex): Promise<ReceiptReading | null> {
  if (contentType !== 'application/pdf') return null

  const eInvoice = parseEInvoice(bytes)
  if (eInvoice.kind === 'ok') {
    const { invoice } = eInvoice
    return {
      amountCents: invoice.totals.totalInclTaxCents - invoice.prepaidCents,
      currency: 'EUR',
      date: invoice.issueDate,
      merchant: invoice.seller.name,
      vatLines: invoice.totals.breakdown.filter((row) => row.vatCents !== 0).map((row) => ({ rateBp: row.vatRateBp, amountCents: row.vatCents })),
      readFrom: 'e-invoice',
    }
  }

  const lines = await pdfTextLines(bytes)
  if (!lines) return null
  const fields = readInvoiceText(lines)
  const merchant = detectVendor(lines)?.name ?? detectTiers(lines, suppliers, 'SUPPLIER')?.name ?? null
  if (fields.amountCents === null && fields.date === null && merchant === null) return null
  return { ...fields, merchant, vatLines: [], readFrom: 'pdf' }
}
