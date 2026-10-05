/**
 * Which open sales invoice a bank credit pays, on plain values
 * (docs/categories-simples.md#recettes-à-vérifier). Pure and deterministic:
 * the service loads the open invoices (invoice-receipts.service.ts), this
 * module only compares.
 *
 * A credit can pay an invoice when its amount is at most what is left to
 * pay (the invoices module records a payment only up to that, lib/invoices/
 * invoice-payments.service.ts). It names the invoice when the bank line
 * carries one of:
 * - the invoice number (letters and digits compared without separators:
 *   "FACT F-2026-012" names F2026012), at least four characters with a digit;
 * - the customer's SIREN (nine digits, spaces allowed);
 * - every significant word of the customer's name (legal forms and words of
 *   two letters left out), as whole words of the counterparty and label.
 *
 * Confidence:
 * - high: the amount is exactly what is left to pay and the line names the
 *   invoice or its customer;
 * - medium: the exact amount without a name, when a single open invoice has
 *   it; a part payment naming the invoice number; a part payment naming the
 *   customer when that customer has a single open invoice. Several invoices
 *   equally named (two invoices of a customer for the same amount): the
 *   oldest due date, at medium confidence;
 * - nothing otherwise: an amount that matches several invoices of different
 *   customers says nothing.
 */

import { bankText } from './payees'
import { words } from '@/lib/subscriptions/detect'
import { formatCentsFr } from '@/lib/utils/money'

export interface OpenInvoice {
  id: string
  number: string
  customerName: string
  /** SIREN of the customer (tiers, or buyer SIREN printed on the invoice). */
  customerSiren: string | null
  /** What is left to pay, payments recorded and simple mode payments waiting for validation deducted. */
  remainingCents: number
  /** yyyy-mm-dd */
  dueDate: string
}

export interface InvoiceMatch {
  invoiceId: string
  number: string
  customerName: string
  remainingCents: number
  /** The credit pays part of the invoice only. */
  partial: boolean
  score: number
  /** Plain French reason. */
  reason: string
}

export const INVOICE_SCORES = { named: 0.95, amountOnly: 0.7, partialNumber: 0.75, partialCustomer: 0.6, ambiguous: 0.7 } as const

/** Legal forms and filler words that do not identify a customer. */
const NOT_A_NAME = new Set(['SARL', 'SAS', 'SASU', 'EURL', 'SA', 'SCI', 'SNC', 'SCOP', 'SELARL', 'SELAS', 'EI', 'EIRL', 'ETS', 'STE', 'SOCIETE', 'CABINET', 'GROUPE', 'THE', 'LES', 'DES', 'DU', 'DE', 'LA', 'LE', 'ET'])

/** Words of a customer name that identify it, split like the bank text (letters and digits apart, payees.ts). */
export function significantWords(name: string): string[] {
  return words(name)
    .flatMap((w) => w.split(/(?<=[A-Z])(?=\d)|(?<=\d)(?=[A-Z])/))
    .filter((w) => w.length >= 3 && !NOT_A_NAME.has(w))
}

const alphanumeric = (text: string) => text.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase()

function namesNumber(label: string, number: string): boolean {
  const n = alphanumeric(number)
  return n.length >= 4 && /\d/.test(n) && alphanumeric(label).includes(n)
}

function namesSiren(label: string, siren: string | null): boolean {
  if (!siren || !/^\d{9}$/.test(siren)) return false
  return (label.match(/\d[\d ]{7,}\d/g) ?? []).some((group) => group.replace(/ /g, '') === siren)
}

function namesCustomer(text: string, name: string): boolean {
  const significant = significantWords(name)
  return significant.length > 0 && significant.every((w) => text.includes(` ${w} `))
}

interface Candidate {
  invoice: OpenInvoice
  exact: boolean
  byNumber: boolean
  byIdentity: boolean
}

const byDueDate = (a: Candidate, b: Candidate) => (a.invoice.dueDate < b.invoice.dueDate ? -1 : a.invoice.dueDate > b.invoice.dueDate ? 1 : a.invoice.id < b.invoice.id ? -1 : 1)

function match(candidate: Candidate, score: number, reason: string): InvoiceMatch {
  const { invoice } = candidate
  return { invoiceId: invoice.id, number: invoice.number, customerName: invoice.customerName, remainingCents: invoice.remainingCents, partial: !candidate.exact, score, reason }
}

/** The open invoice a credit of `amountCents` pays, or null (see the module header). */
export function matchInvoice(tx: { amountCents: number; label: string | null; counterpartyName: string | null }, invoices: readonly OpenInvoice[]): InvoiceMatch | null {
  if (tx.amountCents <= 0) return null
  const label = `${tx.counterpartyName ?? ''} ${tx.label ?? ''}`
  const text = bankText(tx.counterpartyName, tx.label)
  const candidates: Candidate[] = invoices
    .filter((invoice) => invoice.remainingCents > 0 && tx.amountCents <= invoice.remainingCents)
    .map((invoice) => {
      const byNumber = namesNumber(label, invoice.number)
      return {
        invoice,
        exact: tx.amountCents === invoice.remainingCents,
        byNumber,
        byIdentity: byNumber || namesSiren(label, invoice.customerSiren) || namesCustomer(text, invoice.customerName),
      }
    })

  // The exact amount and a name: the invoice, unless several are named.
  const named = candidates.filter((c) => c.exact && c.byIdentity).sort(byDueDate)
  if (named.length > 0) {
    const numbered = named.filter((c) => c.byNumber)
    if (numbered.length === 1 || named.length === 1) {
      const best = numbered[0] ?? named[0]
      return match(best, INVOICE_SCORES.named, `Règle la facture n° ${best.invoice.number} de ${best.invoice.customerName}`)
    }
    return match(named[0], INVOICE_SCORES.ambiguous, `Plusieurs factures de ce montant : la plus ancienne, n° ${named[0].invoice.number}`)
  }

  // A part payment that names the invoice number.
  const partByNumber = candidates.filter((c) => !c.exact && c.byNumber).sort(byDueDate)
  if (partByNumber.length === 1) {
    const best = partByNumber[0]
    return match(best, INVOICE_SCORES.partialNumber, `Paiement partiel de la facture n° ${best.invoice.number}, sur ${formatCentsFr(best.invoice.remainingCents)} à payer`)
  }

  // The exact amount alone: only when a single open invoice has it.
  const sameAmount = candidates.filter((c) => c.exact)
  if (sameAmount.length === 1) {
    const best = sameAmount[0]
    return match(best, INVOICE_SCORES.amountOnly, `Même montant que la facture n° ${best.invoice.number} de ${best.invoice.customerName}`)
  }

  // A part payment naming the customer, who has a single open invoice.
  const customers = candidates.filter((c) => !c.exact && c.byIdentity)
  if (customers.length === 1) {
    const best = customers[0]
    const ofCustomer = invoices.filter((i) => i.remainingCents > 0 && namesCustomer(text, i.customerName))
    if (ofCustomer.length === 1) {
      return match(best, INVOICE_SCORES.partialCustomer, `Paiement partiel de la facture n° ${best.invoice.number} de ${best.invoice.customerName}`)
    }
  }
  return null
}
