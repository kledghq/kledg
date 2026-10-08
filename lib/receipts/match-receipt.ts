/**
 * Which bank transaction a receipt belongs to (docs/justificatifs-photo.md).
 * Pure module: the service (file-receipt.service.ts) loads the debit
 * transactions of the company around the receipt's date, this module
 * scores them.
 *
 * A transaction is a candidate when it is a debit without receipt, dated
 * from 3 days before to 10 days after the receipt (a card payment is booked
 * a few days after the purchase, a pre-authorisation or an invoice paid
 * early can precede it) and either has the amount of the receipt or a name
 * close to the merchant's:
 * - amount: equal within one cent, in euros; for a receipt in another
 *   currency, the transaction's original amount in that currency when the
 *   bank gives it (Qonto local_amount), else no amount match;
 * - date: the closer the better, the same day or the next two best;
 * - merchant: the words of the merchant read on the receipt against the
 *   label, the counterparty and the supplier Kledg recognises in them (a
 *   known vendor, a supplier tiers): the same known vendor on both sides,
 *   or words in common.
 *
 * The receipt is matched when one candidate has the amount, scores at least
 * MATCH_THRESHOLD and leads the next one by MATCH_MARGIN; otherwise the best
 * candidates (CANDIDATE_LIMIT) are proposed, or none. A receipt paid with a
 * personal card or in cash never matches a bank transaction of the company:
 * it is an expense report (note de frais).
 */

import { addIsoDays } from '@/lib/utils/date'
import { toCents } from '@/lib/utils/money'
import { detectVendor, words } from './detect-supplier'

/** Days a transaction may precede the receipt, and follow it. */
export const DATE_WINDOW = { before: 3, after: 10 } as const
/** One cent of tolerance on the amount (rounding of the assistant or of a conversion). */
export const AMOUNT_TOLERANCE_CENTS = 1
export const MATCH_THRESHOLD = 0.75
export const MATCH_MARGIN = 0.15
export const CANDIDATE_LIMIT = 5
/** A candidate without the amount needs at least this merchant similarity. */
const MERCHANT_ONLY_THRESHOLD = 0.6

export const PAYMENT_HINTS = ['company_card', 'personal_card', 'cash', 'transfer', 'direct_debit', 'unknown'] as const
export type PaymentHint = (typeof PAYMENT_HINTS)[number]

/** Paid by the person, not by the company's account: an expense report. */
export const PERSONAL_PAYMENTS: ReadonlySet<PaymentHint> = new Set(['personal_card', 'cash'])

export interface ReceiptFields {
  /** Amount paid, VAT included, in cents of `currency`. */
  amountCents: number
  /** ISO 4217, upper case. */
  currency: string
  /** yyyy-mm-dd */
  date: string
  merchant: string | null
  paymentHint: PaymentHint | null
}

export interface TransactionCandidate {
  id: string
  /** yyyy-mm-dd */
  date: string
  /** Amount in euros (cents), positive. */
  amountCents: number
  side: 'debit' | 'credit'
  label: string | null
  counterpartyName: string | null
  /** Amount and currency of the operation before conversion, when the bank gives them. */
  original: { amountCents: number; currency: string } | null
  /** The transaction already has a receipt (an attachment). */
  hasReceipt: boolean
  /** Names of the supplier recognised in the label (known vendor or supplier tiers). */
  supplierNames: string[]
}

export interface ScoredCandidate {
  transactionId: string
  /** 0 to 1. */
  score: number
  amountMatch: boolean
  /** Days from the receipt to the transaction (negative: before). */
  dayOffset: number
  merchantScore: number
  /** Why it was proposed, in French, for the user. */
  reasons: string[]
}

export type MatchOutcome =
  | { outcome: 'matched'; match: ScoredCandidate; candidates: ScoredCandidate[] }
  | { outcome: 'candidates'; candidates: ScoredCandidate[] }
  | { outcome: 'none'; candidates: []; reason: 'personal_payment' | 'no_candidate' }

/** Generic words of bank labels and receipts that say nothing about the merchant. */
const NOISE = new Set([
  'cb', 'carte', 'paiement', 'prlv', 'prelevement', 'sepa', 'vir', 'virement', 'achat', 'facture', 'ticket', 'recu', 'fact', 'du', 'de', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux',
  'sa', 'sas', 'sasu', 'sarl', 'eurl', 'sci', 'snc', 'ei', 'inc', 'ltd', 'llc', 'gmbh', 'srl', 'bv', 'plc', 'eur', 'euro', 'euros', 'fr', 'france', 'paris', 'www', 'com', 'net',
])

/** The meaningful words of a name: lower case, no accents, no digits-only words, no generic words. */
export function merchantWords(text: string | null | undefined): string[] {
  if (!text) return []
  return [...new Set(words(text).split(' ').filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !NOISE.has(w)))]
}

/**
 * Similarity of a merchant name with the texts of a transaction, 0 to 1:
 * 1 when both name the same known vendor, else the share of the merchant's
 * words found in the best text (a word of 4 letters or more also counts
 * when one contains the other: "boulangerie" and "boulang").
 */
export function merchantSimilarity(merchant: string | null, texts: ReadonlyArray<string | null | undefined>): number {
  const wanted = merchantWords(merchant)
  if (wanted.length === 0) return 0
  const vendor = detectVendor([merchant])
  if (vendor && detectVendor(texts)?.id === vendor.id) return 1
  let best = 0
  for (const text of texts) {
    const have = merchantWords(text)
    if (have.length === 0) continue
    const found = wanted.filter((w) => have.some((h) => h === w || (w.length >= 4 && h.length >= 4 && (h.startsWith(w) || w.startsWith(h)))))
    best = Math.max(best, found.length / wanted.length)
  }
  return Math.round(best * 100) / 100
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** 1 the same day and the two days after, then down to 0.3 at the end of the window. */
export function dateScore(offset: number): number {
  if (offset < -DATE_WINDOW.before || offset > DATE_WINDOW.after) return 0
  if (offset >= 0 && offset <= 2) return 1
  if (offset < 0) return 1 - 0.15 * -offset
  return Math.round((1 - (0.7 * (offset - 2)) / (DATE_WINDOW.after - 2)) * 100) / 100
}

/** The first and last day of the transactions worth loading for a receipt dated `date`. */
export function candidateWindow(date: string): { from: string; to: string } {
  return { from: addIsoDays(date, -DATE_WINDOW.before), to: addIsoDays(date, DATE_WINDOW.after) }
}

function frDays(n: number): string {
  return `${n} jour${n > 1 ? 's' : ''}`
}

/** Scores one transaction, or null when it cannot be the receipt's. */
export function scoreCandidate(receipt: ReceiptFields, t: TransactionCandidate): ScoredCandidate | null {
  if (t.side !== 'debit' || t.hasReceipt) return null
  const dayOffset = daysBetween(receipt.date, t.date)
  const date = dateScore(dayOffset)
  if (date === 0) return null
  const reasons: string[] = []
  const currency = receipt.currency.toUpperCase()
  let amountMatch = false
  if (currency === 'EUR') {
    amountMatch = Math.abs(t.amountCents - receipt.amountCents) <= AMOUNT_TOLERANCE_CENTS
    if (amountMatch) reasons.push('Montant identique')
  } else if (t.original && t.original.currency.toUpperCase() === currency) {
    amountMatch = Math.abs(t.original.amountCents - receipt.amountCents) <= AMOUNT_TOLERANCE_CENTS
    if (amountMatch) reasons.push(`Montant d’origine identique (${currency})`)
  }
  const merchantScore = merchantSimilarity(receipt.merchant, [t.counterpartyName, t.label, ...t.supplierNames])
  if (!amountMatch && merchantScore < MERCHANT_ONLY_THRESHOLD) return null
  if (!amountMatch) reasons.push(currency === 'EUR' || t.original ? 'Montant différent' : `Montant en ${currency} non comparable`)
  reasons.push(dayOffset === 0 ? 'Même jour' : dayOffset > 0 ? `Débitée ${frDays(dayOffset)} après` : `Débitée ${frDays(-dayOffset)} avant`)
  if (merchantScore >= 1) reasons.push('Même commerçant')
  else if (merchantScore >= 0.5) reasons.push('Libellé proche du commerçant')
  const score = amountMatch ? 0.55 + 0.25 * date + 0.2 * merchantScore : 0.15 * date + 0.3 * merchantScore
  return { transactionId: t.id, score: Math.round(score * 1000) / 1000, amountMatch, dayOffset, merchantScore, reasons }
}

/** The outcome of a receipt against the transactions loaded for it. */
export function matchReceipt(receipt: ReceiptFields, transactions: readonly TransactionCandidate[]): MatchOutcome {
  if (receipt.paymentHint && PERSONAL_PAYMENTS.has(receipt.paymentHint)) return { outcome: 'none', candidates: [], reason: 'personal_payment' }
  const scored = transactions
    .map((t) => scoreCandidate(receipt, t))
    .filter((c): c is ScoredCandidate => c !== null)
    .sort((a, b) => b.score - a.score || Math.abs(a.dayOffset) - Math.abs(b.dayOffset) || a.transactionId.localeCompare(b.transactionId))
  if (scored.length === 0) return { outcome: 'none', candidates: [], reason: 'no_candidate' }
  const [best, second] = scored
  const candidates = scored.slice(0, CANDIDATE_LIMIT)
  if (best.amountMatch && best.score >= MATCH_THRESHOLD && (!second || best.score - second.score >= MATCH_MARGIN)) {
    return { outcome: 'matched', match: best, candidates }
  }
  return { outcome: 'candidates', candidates }
}

/**
 * The amount and currency before conversion of a synced transaction, from
 * the provider's payload: Qonto's local_amount (or local_amount_cents) and
 * local_currency; null when the payload gives none or the same currency.
 */
export function originalAmountOf(providerData: unknown): { amountCents: number; currency: string } | null {
  if (!providerData || typeof providerData !== 'object') return null
  const data = providerData as Record<string, unknown>
  const currency = typeof data.local_currency === 'string' ? data.local_currency.toUpperCase() : null
  if (!currency || !/^[A-Z]{3}$/.test(currency) || currency === 'EUR') return null
  const cents =
    typeof data.local_amount_cents === 'number' && Number.isInteger(data.local_amount_cents)
      ? Math.abs(data.local_amount_cents)
      : typeof data.local_amount === 'number'
        ? toCents(Math.abs(data.local_amount))
        : null
  return cents === null ? null : { amountCents: cents, currency }
}
