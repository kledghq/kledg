/**
 * An electronic invoice read from a file (EN 16931: CII, the XML of
 * Factur-X, or UBL), before and after its amounts are checked.
 *
 * `RawEInvoice` holds the values as the document writes them (strings),
 * whatever the syntax; normalize.ts turns it into a `ParsedEInvoice` in
 * cents and basis points, or refuses it with a French reason. The business
 * terms (BT-x) are those of EN 16931-1.
 */

import type { InvoiceTotals } from '../amounts'

export type EInvoiceFormat = 'factur-x' | 'cii' | 'ubl'

export interface RawParty {
  /** BT-27 / BT-44. */
  name: string | null
  /** BT-30 / BT-47 legal registration ids and BT-29 / BT-46 ids, with their scheme (0002 SIREN, 0009 SIRET). */
  ids: Array<{ value: string; scheme: string | null }>
  /** BT-31 / BT-48. */
  vatNumber: string | null
  address: { lines: string[]; postalCode: string | null; city: string | null; country: string | null } | null
}

export interface RawLine {
  /** BT-153 item name, else BT-154 description. */
  name: string | null
  /** BT-129 invoiced quantity. */
  quantity: string | null
  /** BT-146 item net price, for BT-149 base quantity units (1 when absent). */
  netPrice: string | null
  baseQuantity: string | null
  /** BT-131 line net amount. */
  netAmount: string | null
  /** BT-151 VAT category code (S, Z, E, AE, K, G, O, L, M). */
  vatCategory: string | null
  /** BT-152, a percentage ("20", "5.50"). */
  vatRate: string | null
}

export interface RawVat {
  /** BT-118. */
  category: string | null
  /** BT-119, a percentage. */
  rate: string | null
  /** BT-116 taxable amount. */
  base: string | null
  /** BT-117 tax amount. */
  amount: string | null
}

export interface RawEInvoice {
  format: EInvoiceFormat
  /** BT-24 specification identifier (Factur-X profile, EN 16931, CIUS). */
  specification: string | null
  /** BT-1. */
  number: string | null
  /** BT-3, UNTDID 1001. */
  typeCode: string | null
  /** BT-2 and BT-9 as yyyy-mm-dd, or null when absent or unreadable. */
  issueDate: string | null
  dueDate: string | null
  /** BT-5. */
  currency: string | null
  seller: RawParty
  buyer: RawParty
  lines: RawLine[]
  /** BG-23 VAT breakdown. */
  vat: RawVat[]
  totals: {
    /** BT-106 sum of the line net amounts. */
    lineTotal: string | null
    /** BT-107 and BT-108 document level allowances and charges. */
    allowances: string | null
    charges: string | null
    /** BT-109 total without VAT. */
    taxBasis: string | null
    /** BT-110 total VAT, in the invoice currency. */
    taxTotal: string | null
    /** BT-112 total with VAT. */
    grandTotal: string | null
    /** BT-113 paid amount. */
    prepaid: string | null
  }
}

export interface EInvoiceParty {
  name: string
  siren: string | null
  siret: string | null
  vatNumber: string | null
  address: { street: string; street2: string | null; postalCode: string; city: string; country: string } | null
}

export interface EInvoiceLine {
  label: string
  quantityThousandths: number
  unitPriceCents: number
  vatRateBp: number
  totalExclTaxCents: number
}

/** An e-invoice whose amounts add up, ready to be recorded as a Kledg invoice. */
export interface ParsedEInvoice {
  format: EInvoiceFormat
  specification: string | null
  number: string
  /** 380 invoice or 381 credit note: the two types Kledg records (invoices_type_code_check). */
  typeCode: '380' | '381'
  issueDate: string
  dueDate: string | null
  seller: EInvoiceParty
  buyer: EInvoiceParty
  lines: EInvoiceLine[]
  totals: InvoiceTotals
  /** BT-113: amount already paid (an advance), to settle outside this invoice. */
  prepaidCents: number
  /** What the user should check, in French. */
  warnings: string[]
}

export type EInvoiceParseResult = { kind: 'ok'; invoice: ParsedEInvoice } | { kind: 'refused'; reason: string }
