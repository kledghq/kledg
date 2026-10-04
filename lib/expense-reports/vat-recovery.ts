/**
 * Recoverable VAT of an expense report line. Pure module (it imports only
 * the category catalogue, itself pure): the line editor shows what the
 * server records.
 *
 * Rules, in order (the first that applies decides):
 *
 * 1. No VAT on the receipt, or a mileage allowance (a scale amount, not a
 *    purchase): nothing to recover.
 * 2. Company under the VAT franchise (CGI art. 293 B): it deducts no VAT.
 * 3. Proof. VAT is deductible only when it appears on an invoice made out
 *    to the company (CGI art. 271, II, 1, a; CGI ann. II art. 242 nonies A
 *    for the mentions). Tolerance for small amounts: a detailed receipt
 *    (ticket) showing the rate and the VAT, of 150 € HT at most, on which
 *    the company adds its name and address, is accepted
 *    (BOI-TVA-DECLA-30-20-20-20, § 130 to 150). Without a receipt, or a
 *    ticket above 150 € HT: no recovery.
 * 4. Exclusions of CGI ann. II art. 206, IV, 2 (version in force since
 *    8 July 2024, Légifrance LEGIARTI000049904359), whose admission
 *    coefficient is nil:
 *    - 2°: goods and services "relatif à la fourniture à titre gratuit du
 *      logement des dirigeants ou du personnel": a hotel paid for an
 *      employee or a dirigeant on a trip (BOI-TVA-DED-30-30-10);
 *    - 5°: "transports de personnes et opérations accessoires" (train,
 *      plane, taxi, VTC), except transport companies and permanent
 *      contracts carrying staff to work (BOI-TVA-DED-30-30-30), which an
 *      expense report never is;
 *    - 3°: goods given away, except goods of very low value: 73 € TTC per
 *      beneficiary and per year (CGI ann. IV art. 28-00 A). Kledg checks the
 *      line: one line per beneficiary.
 *    In the current text 4° (alcohol advertising) is repealed; transport of
 *    persons is 5° and lodging 2°, as in BOI-TVA-DED-30-30-10 and -30.
 * 5. Fuel of a passenger car: 80 % of the VAT on petrol and diesel is
 *    deductible (CGI art. 298, 4, 1°, a; BOI-TVA-DED-30-30-40). A company
 *    whose vehicle is a utility vehicle recovers 100 %: choose another
 *    category.
 * 6. Otherwise the whole VAT shown.
 *
 * Amounts are integer cents; the 80 % share is rounded half away from zero.
 */

import { EXPENSE_CATEGORIES, type ExpenseCategory } from './categories'

/** Simplified receipts are accepted up to this amount excluding tax (BOI-TVA-DECLA-30-20-20-20, § 130). */
export const SIMPLIFIED_RECEIPT_MAX_EXCL_TAX_CENTS = 15_000

/** Gifts of very low value: 73 € TTC per beneficiary and per year (CGI ann. IV art. 28-00 A). */
export const GIFT_MAX_INCL_TAX_CENTS = 7_300

/** Share of the VAT on fuel of passenger cars that is deductible, in percent (CGI art. 298, 4, 1°, a). */
export const FUEL_RECOVERY_PERCENT = 80

export type ReceiptKind = 'NONE' | 'RECEIPT' | 'INVOICE'

export interface RecoveryInput {
  category: ExpenseCategory
  receiptKind: ReceiptKind
  amountInclTaxCents: number
  vatCents: number
  /** The company is under the VAT franchise (CGI art. 293 B). */
  vatExempt: boolean
  /** A mileage line: no VAT at all. */
  mileage?: boolean
}

export type RecoveryReason =
  | 'full'
  | 'fuel-80'
  | 'no-vat'
  | 'franchise'
  | 'no-receipt'
  | 'receipt-over-150'
  | 'passenger-transport'
  | 'staff-lodging'
  | 'gift-over-73'

export interface Recovery {
  recoverableVatCents: number
  reason: RecoveryReason
}

/** French explanation of each outcome, shown next to the line. */
export const RECOVERY_LABELS: Record<RecoveryReason, string> = {
  full: 'TVA récupérable',
  'fuel-80': 'TVA récupérable à 80 % (carburant d’un véhicule de tourisme, CGI art. 298)',
  'no-vat': 'Sans TVA',
  franchise: 'Société en franchise en base\u00a0: TVA non récupérable (CGI art. 293 B)',
  'no-receipt': 'Sans justificatif\u00a0: TVA non récupérable',
  'receipt-over-150': 'Ticket au-delà de 150 € HT\u00a0: une facture au nom de la société est nécessaire pour récupérer la TVA',
  'passenger-transport': 'Transport de personnes\u00a0: TVA non récupérable (CGI ann. II art. 206, IV, 2, 5°)',
  'staff-lodging': 'Hébergement des dirigeants ou du personnel\u00a0: TVA non récupérable (CGI ann. II art. 206, IV, 2, 2°)',
  'gift-over-73': 'Cadeau de plus de 73 € TTC\u00a0: TVA non récupérable (CGI ann. II art. 206, IV, 2, 3°)',
}

/** n x percent / 100 rounded half away from zero, n >= 0. */
function percentOf(n: number, percent: number): number {
  return Math.floor((n * percent * 2 + 100) / 200)
}

export function recoverableVat(input: RecoveryInput): Recovery {
  if (input.mileage || input.vatCents <= 0) return { recoverableVatCents: 0, reason: 'no-vat' }
  if (input.vatExempt) return { recoverableVatCents: 0, reason: 'franchise' }
  if (input.receiptKind === 'NONE') return { recoverableVatCents: 0, reason: 'no-receipt' }
  if (input.receiptKind === 'RECEIPT' && input.amountInclTaxCents - input.vatCents > SIMPLIFIED_RECEIPT_MAX_EXCL_TAX_CENTS) {
    return { recoverableVatCents: 0, reason: 'receipt-over-150' }
  }
  switch (EXPENSE_CATEGORIES[input.category].vatRule) {
    case 'passenger-transport':
      return { recoverableVatCents: 0, reason: 'passenger-transport' }
    case 'staff-lodging':
      return { recoverableVatCents: 0, reason: 'staff-lodging' }
    case 'gift':
      if (input.amountInclTaxCents > GIFT_MAX_INCL_TAX_CENTS) return { recoverableVatCents: 0, reason: 'gift-over-73' }
      return { recoverableVatCents: input.vatCents, reason: 'full' }
    case 'fuel':
      return { recoverableVatCents: percentOf(input.vatCents, FUEL_RECOVERY_PERCENT), reason: 'fuel-80' }
    case 'none':
      return { recoverableVatCents: 0, reason: 'no-vat' }
    default:
      return { recoverableVatCents: input.vatCents, reason: 'full' }
  }
}

/**
 * VAT included in an amount at a rate (basis points): TTC x rate / (1 + rate),
 * rounded half away from zero. What the editor proposes from the TTC.
 */
export function vatIncludedCents(amountInclTaxCents: number, rateBp: number): number {
  if (rateBp <= 0 || amountInclTaxCents <= 0) return 0
  return Math.floor((amountInclTaxCents * rateBp * 2 + (10_000 + rateBp)) / (2 * (10_000 + rateBp)))
}

/** A VAT typed from a receipt may differ from the computed one by rounding per item: 2 cents at most. */
export const VAT_TOLERANCE_CENTS = 2
