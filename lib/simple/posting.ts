/**
 * From a simple mode category to the counterpart lines of the entry that
 * books a bank transaction. Pure: the page previews what the server writes,
 * the server recomputes it from the database (docs/categories-simples.md).
 *
 * 1. The category's question, when it applies, decides the account and the
 *    VAT rule (resolvePosting). The durable equipment question applies only
 *    above 500 € HT (BOI-BIC-CHG-20-30-10); below, the purchase is expensed.
 * 2. The VAT included in the amount is the VAT the bank read on the receipt
 *    when it gives a plausible one (at most 20 % of the base, CGI art. 278),
 *    else the category's rate applied to the amount (TTC x rate / (1 + rate),
 *    rounded half up, lib/expense-reports/vat-recovery.ts).
 * 3. Expenses: the recoverable part follows the category's rule
 *    (recoverableVatByRule: passenger transport and staff lodging nothing,
 *    fuel 80 %, gifts up to 73 € TTC, passenger vehicles nothing, CGI ann. II
 *    art. 206, IV, 2). A company under VAT exemption recovers the share given
 *    by its provisional coefficient de déduction (lib/vat-deduction/coefficient.ts:
 *    nothing for a franchise, CGI art. 293 B). The recoverable VAT goes to 44562 for
 *    a fixed asset, 44566 otherwise (PCG art. 944-44); the rest stays in the
 *    charge or the asset.
 * 4. Income: the collected VAT goes to 44571, unless the company is exempt.
 *    A refund of an expense (money in) takes back what the expense booked:
 *    the same lines on the credit side, the recovered VAT included.
 * 5. Movements that are not taxed operations (taxes paid, loans, transfers,
 *    salaries) and categories without VAT: one line for the whole amount.
 *
 * Counterpart lines carry the opposite of the bank line (money out: debits),
 * so they sum exactly to the transaction amount. Amounts are integer cents.
 */

import { recoverableVatByRule, vatIncludedCents, RECOVERY_LABELS } from '@/lib/expense-reports/vat-recovery'
import type { CategoryKind, Posting, Question, SimpleCategory } from './categories'

export type Side = 'debit' | 'credit'
export type Answers = Record<string, string>

export type Resolution =
  | { status: 'pending'; question: Question }
  | { status: 'invalid'; question: Question; message: string }
  | { status: 'ready'; posting: Posting; answers: Answers; question: Question | null; kind: CategoryKind }

/** Deductible VAT on fixed assets and on other goods and services, collected VAT (PCG art. 944-44). */
export const VAT_ON_ASSETS = '44562'
export const VAT_DEDUCTIBLE = '44566'
export const VAT_COLLECTED = '44571'

/** Highest French rate (CGI art. 278): a VAT read by the bank above it is not trusted. */
const MAX_RATE_PERCENT = 20

/** Amount excluding VAT at a rate: what the 500 € HT threshold compares. */
export function exclTaxCents(amountCents: number, rateBp: number, bankVatCents?: number | null): number {
  if (rateBp <= 0) return amountCents
  const vat = plausibleBankVat(amountCents, bankVatCents) ?? vatIncludedCents(amountCents, rateBp)
  return amountCents - vat
}

/** Whether the category asks its question for this amount. */
export function questionApplies(category: SimpleCategory, amountCents: number, bankVatCents?: number | null): boolean {
  const question = category.question
  if (!question) return false
  if (question.aboveExclTaxCents === undefined) return true
  return exclTaxCents(amountCents, category.posting.vatRateBp, bankVatCents) > question.aboveExclTaxCents
}

/**
 * The posting of a category once its question is answered. `pending` when
 * the question applies and has neither an answer nor a default; `invalid`
 * when the answer is not one of the question's.
 */
export function resolvePosting(category: SimpleCategory, answers: Answers, amountCents: number, bankVatCents?: number | null): Resolution {
  const question = category.question
  if (!question || !questionApplies(category, amountCents, bankVatCents)) {
    return { status: 'ready', posting: { ...category.posting }, answers: {}, question: null, kind: category.kind }
  }
  const answerId = answers[question.id] ?? question.defaultAnswerId
  if (!answerId) return { status: 'pending', question }
  const answer = question.answers.find((a) => a.id === answerId)
  if (!answer) {
    return { status: 'invalid', question, message: `Réponse inconnue à la question « ${question.text} » : choisissez l'une des réponses proposées.` }
  }
  return { status: 'ready', posting: { ...category.posting, ...answer.posting }, answers: { [question.id]: answer.id }, question, kind: answer.kind ?? category.kind }
}

/** The VAT the bank read, when it is plausible: positive, below the amount, at most 20 % of the base (one cent of rounding). */
export function plausibleBankVat(amountCents: number, bankVatCents?: number | null): number | null {
  if (bankVatCents == null || !Number.isSafeInteger(bankVatCents) || bankVatCents <= 0 || bankVatCents >= amountCents) return null
  const base = amountCents - bankVatCents
  return bankVatCents * 100 <= base * MAX_RATE_PERCENT + 100 ? bankVatCents : null
}

export interface CounterpartLine {
  accountCode: string
  debitCents: number
  creditCents: number
  /** The charge, product or movement, or the VAT. */
  role: 'base' | 'vat'
}

export interface PostingPlan {
  lines: CounterpartLine[]
  /** VAT included in the amount (0 without VAT). */
  vatCents: number
  /** Part of it booked to a VAT account. */
  vatBookedCents: number
  /** Plain French explanation of the VAT, for the accountant. */
  vatNote: string
}

export interface PostingInput {
  category: SimpleCategory
  posting: Posting
  /** What the money is once the question is answered (resolvePosting); the category's kind by default. */
  kind?: CategoryKind
  side: Side
  /** Absolute amount of the transaction, VAT included. */
  amountCents: number
  /** VAT read by the bank on the receipt (Qonto), in cents. */
  bankVatCents?: number | null
  /**
   * The company is exempt from VAT (franchise or exempt activity) or partly
   * exempt and recovers this share of its deductible VAT (0 to 1, its
   * provisional coefficient de déduction, lib/vat-deduction/coefficient.ts).
   * Null: subject to VAT, full recovery.
   */
  recoveryRatio: number | null
}

/** n x ratio rounded half away from zero, n >= 0. Ratios come from cent sums, rounded to 1e-6 here. */
function share(n: number, ratio: number): number {
  const millionths = Math.round(Math.min(Math.max(ratio, 0), 1) * 1_000_000)
  return Math.floor((n * millionths * 2 + 1_000_000) / 2_000_000)
}

const PASSENGER_VEHICLE_NOTE = 'Véhicule de tourisme : TVA non récupérable (CGI ann. II art. 206, IV, 2, 6°)'

/** The counterpart lines of the entry, summing to the amount on the side opposite to the bank line. */
export function buildPostingLines(input: PostingInput): PostingPlan {
  const { category, posting, side, amountCents } = input
  const kind = input.kind ?? category.kind
  const line = (accountCode: string, cents: number, role: CounterpartLine['role']): CounterpartLine =>
    side === 'debit' ? { accountCode, debitCents: cents, creditCents: 0, role } : { accountCode, debitCents: 0, creditCents: cents, role }
  const single = (vatNote: string): PostingPlan => ({ lines: [line(posting.account, amountCents, 'base')], vatCents: 0, vatBookedCents: 0, vatNote })

  if (posting.vatRateBp <= 0 || posting.vatRule === 'none' || kind === 'other') return single(RECOVERY_LABELS['no-vat'])

  const vatCents = plausibleBankVat(amountCents, input.bankVatCents) ?? vatIncludedCents(amountCents, posting.vatRateBp)
  if (vatCents <= 0) return single(RECOVERY_LABELS['no-vat'])

  if (kind === 'income') {
    if (input.recoveryRatio !== null) return { ...single('Société exonérée de TVA : pas de TVA collectée'), vatCents }
    return {
      lines: [line(posting.account, amountCents - vatCents, 'base'), line(VAT_COLLECTED, vatCents, 'vat')],
      vatCents,
      vatBookedCents: vatCents,
      vatNote: 'TVA collectée',
    }
  }

  let recoverable: number
  let vatNote: string
  if (posting.vatRule === 'passenger-vehicle') {
    recoverable = 0
    vatNote = PASSENGER_VEHICLE_NOTE
  } else {
    // The receipt is taken as an invoice to the company: the accountant checks it when validating.
    const recovery = recoverableVatByRule(posting.vatRule, { receiptKind: 'INVOICE', amountInclTaxCents: amountCents, vatCents, vatExempt: false })
    recoverable = recovery.recoverableVatCents
    vatNote = RECOVERY_LABELS[recovery.reason]
  }
  if (input.recoveryRatio !== null && recoverable > 0) {
    recoverable = share(recoverable, input.recoveryRatio)
    vatNote = `Coefficient de déduction provisoire : ${Math.round(input.recoveryRatio * 100)} % de la TVA récupérable (CGI ann. II art. 206)`
  }
  if (recoverable <= 0) return { ...single(vatNote), vatCents }
  const vatAccount = posting.account.startsWith('2') ? VAT_ON_ASSETS : VAT_DEDUCTIBLE
  return {
    lines: [line(posting.account, amountCents - recoverable, 'base'), line(vatAccount, recoverable, 'vat')],
    vatCents,
    vatBookedCents: recoverable,
    vatNote,
  }
}
