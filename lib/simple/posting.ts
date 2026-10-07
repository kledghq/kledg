/**
 * From a simple mode category to the counterpart lines of the entry that
 * books a bank transaction. Pure: the page previews what the server writes,
 * the server recomputes it from the database (docs/categories-simples.md).
 *
 * 1. The category's question, when it applies, decides the account and the
 *    VAT rule (resolvePosting). The durable equipment question applies only
 *    above 500 € HT (BOI-BIC-CHG-20-30-10); below, the purchase is expensed.
 * 2. The VAT included in the amount is the VAT the bank read on the receipt
 *    when it can be trusted (lib/banking/bank-vat.ts: at most 20 % of the
 *    base, CGI art. 278; zero only with a rate of 0 %), else the category's rate applied to the amount (TTC x rate / (1 + rate),
 *    rounded half up, lib/expense-reports/vat-recovery.ts).
 * 3. Expenses: the recoverable part follows the category's rule
 *    (recoverableVatByRule: passenger transport and staff lodging nothing,
 *    fuel 80 %, gifts up to 73 € TTC, passenger vehicles nothing, CGI ann. II
 *    art. 206, IV, 2). A company under VAT exemption recovers the share given
 *    by its provisional coefficient de déduction (lib/vat-deduction/coefficient.ts:
 *    nothing for a franchise, CGI art. 293 B). The recoverable VAT goes to 44562 for
 *    a fixed asset, 44566 otherwise (PCG art. 944-44); the rest stays in the
 *    charge or the asset.
 * 4. Income: the collected VAT goes to 44571, unless the company is under
 *    the franchise (CGI art. 293 B). A partly exempt company (coefficient de
 *    déduction) collects VAT on its taxed sales like any other: the
 *    coefficient limits what it deducts, never what it collects; an exempt
 *    sale is the answer "Sans TVA".
 *    A refund of an expense (money in) takes back what the expense booked:
 *    the same lines on the credit side, the recovered VAT included.
 * 5. Movements that are not taxed operations (taxes paid, loans, transfers,
 *    salaries) and categories without VAT: one line for the whole amount.
 *    Bank fees and payment commissions (rule `detected`, exempt unless the
 *    bank opted, CGI art. 261 C, 1° and 260 B): the VAT the bank read is
 *    deducted, none otherwise.
 *    A service of a supplier established outside France (rule
 *    `self-assessed`, CGI art. 259, 1° and 283, 2): the amount paid is the
 *    price without VAT; the VAT at the category's rate is due on 4452 and
 *    deducted on 44566, as the rules library templates book it.
 *
 * 6. A meal alone of the exploitant at a company taxed at the impôt sur le
 *    revenu (answer "alone" of the meal question, exploitantMeal set by the
 *    caller): the charge is split, the deductible part (the frais
 *    supplémentaires) on 6256, the rest on 62568 to add back
 *    (lib/expense-reports/exploitant-meals.ts, BOI-BNC-BASE-40-60-60). The
 *    VAT is unchanged.
 *
 * Counterpart lines carry the opposite of the bank line (money out: debits),
 * so they sum exactly to the transaction amount. Amounts are integer cents.
 */

import { trustedBankVatCents } from '@/lib/banking/bank-vat'
import { vatOnBaseCents } from '@/lib/invoices/amounts'
import { deductibleVatCents, selfAssessedSplit } from '@/lib/vat-deduction/share'
import { recoverableVatByRule, vatIncludedCents, RECOVERY_LABELS } from '@/lib/expense-reports/vat-recovery'
import { NON_DEDUCTIBLE_MEALS_ACCOUNT, splitExploitantMeal, type MealSplit } from '@/lib/expense-reports/exploitant-meals'
import { EXPLOITANT_MEAL_ANSWER, type CategoryKind, type Posting, type Question, type SimpleCategory } from './categories'

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

/**
 * The VAT the bank read, as bankVatCentsOf gives it (lib/banking/bank-vat.ts,
 * the one plausibility rule): 0 when the receipt shows no VAT, a positive
 * amount below the amount and at most 20 % of the base (one cent of
 * rounding), null otherwise.
 */
export function plausibleBankVat(amountCents: number, bankVatCents?: number | null): number | null {
  return trustedBankVatCents(amountCents, bankVatCents == null ? null : { amountCents: bankVatCents, ratePercent: bankVatCents === 0 ? 0 : null })
}

export interface CounterpartLine {
  accountCode: string
  debitCents: number
  creditCents: number
  /** The charge, product or movement, the VAT, or the non-deductible part of a meal of the exploitant. */
  role: 'base' | 'vat' | 'non-deductible'
}

export interface PostingPlan {
  lines: CounterpartLine[]
  /** VAT included in the amount (0 without VAT). */
  vatCents: number
  /** Part of it booked to a VAT account. */
  vatBookedCents: number
  /** Plain French explanation of the VAT, for the accountant. */
  vatNote: string
  /** Split of a meal of the exploitant (exploitantMeal), null otherwise. */
  mealSplit?: MealSplit | null
}

export interface PostingInput {
  category: SimpleCategory
  posting: Posting
  /** What the money is once the question is answered (resolvePosting); the category's kind by default. */
  kind?: CategoryKind
  side: Side
  /** Absolute amount of the transaction, VAT included. */
  amountCents: number
  /** VAT read by the bank on the receipt (Qonto), in cents, as bankVatCentsOf trusts it: 0 when the receipt shows no VAT. */
  bankVatCents?: number | null
  /**
   * The company is exempt from VAT (franchise or exempt activity) or partly
   * exempt and recovers this share of its deductible VAT (0 to 1, its
   * provisional coefficient de déduction, lib/vat-deduction/coefficient.ts).
   * Null: subject to VAT, full recovery.
   */
  recoveryRatio: number | null
  /**
   * The company is under the franchise en base (CGI art. 293 B): no VAT
   * collected on its sales. Absent: it collects VAT on its taxed sales,
   * whatever its coefficient de déduction.
   */
  franchise?: boolean
  /**
   * The operation is a meal alone of the exploitant of a company taxed at
   * the impôt sur le revenu, in this calendar year: the charge is split
   * (isExploitantMeal tells when). Null or absent: no split.
   */
  exploitantMeal?: { year: number } | null
}

/** Whether a resolved meal answer is the meal alone of the exploitant (the caller checks the company is at IR). */
export function isExploitantMeal(answers: Answers): boolean {
  return answers[EXPLOITANT_MEAL_ANSWER.questionId] === EXPLOITANT_MEAL_ANSWER.answerId
}

/** Replaces the charge line of an expense by its deductible and non-deductible parts. */
function withMealSplit(plan: PostingPlan, amountCents: number, year: number): PostingPlan {
  const base = plan.lines.find((l) => l.role === 'base')
  if (!base || base.debitCents <= 0) return plan
  const split = splitExploitantMeal({ amountInclTaxCents: amountCents, chargeCents: base.debitCents, year })
  if (split.nonDeductibleCents <= 0) return { ...plan, mealSplit: split }
  const parts: CounterpartLine[] = [
    ...(split.deductibleCents > 0 ? [{ ...base, debitCents: split.deductibleCents }] : []),
    { accountCode: NON_DEDUCTIBLE_MEALS_ACCOUNT.root, debitCents: split.nonDeductibleCents, creditCents: 0, role: 'non-deductible' },
  ]
  return { ...plan, lines: plan.lines.flatMap((l) => (l === base ? parts : [l])), mealSplit: split }
}

/** The counterpart lines of the entry, with the split of a meal of the exploitant when asked. */
export function buildPostingLines(input: PostingInput): PostingPlan {
  const plan = buildPlainPostingLines(input)
  const kind = input.kind ?? input.category.kind
  return input.exploitantMeal && kind === 'expense' && input.side === 'debit' ? withMealSplit(plan, input.amountCents, input.exploitantMeal.year) : plan
}


/** Self-assessed VAT due (PCG art. 944-44, compte 4452 TVA due intracommunautaire): a service of a supplier established outside France. */
export const VAT_SELF_ASSESSED = '4452'

const DETECTED_NONE_NOTE = 'Opération exonérée (CGI art. 261 C, 1°)\u00a0: aucune TVA lue sur la facture'
const SELF_ASSESSED_NOTE = 'TVA autoliquidée\u00a0: fournisseur établi hors de France (CGI art. 259, 1° et 283, 2)'

const coefficientNote = (ratio: number) => `Coefficient de déduction provisoire\u00a0: ${Math.round(ratio * 100)} % de la TVA récupérable (CGI ann. II art. 206)`

/**
 * A service of a supplier established outside France: the amount paid is
 * the price without VAT; the VAT at the category's rate on it is due on 4452
 * and deducted on 44566 (the share of a coefficient de déduction, the rest
 * in the charge), as the rules library books it (selfAssessedLine). The
 * lines still sum to the amount paid.
 */
function selfAssessedPlan(input: PostingInput, line: (accountCode: string, cents: number, role: CounterpartLine['role']) => CounterpartLine): PostingPlan {
  const { posting, side, amountCents } = input
  const vatCents = vatOnBaseCents(amountCents, posting.vatRateBp > 0 ? posting.vatRateBp : SELF_ASSESSED_RATE_BP)
  // Due in full, deducted at the coefficient, the rest in the charge (lib/vat-deduction/share.ts)
  const split = selfAssessedSplit(vatCents, input.recoveryRatio)
  const recoverable = split.deductibleCents
  const vatNote = input.recoveryRatio !== null ? `${SELF_ASSESSED_NOTE}. ${coefficientNote(input.recoveryRatio)}` : SELF_ASSESSED_NOTE
  const due: CounterpartLine =
    side === 'debit'
      ? { accountCode: VAT_SELF_ASSESSED, debitCents: 0, creditCents: split.dueCents, role: 'vat' }
      : { accountCode: VAT_SELF_ASSESSED, debitCents: split.dueCents, creditCents: 0, role: 'vat' }
  const vatAccount = posting.account.startsWith('2') ? VAT_ON_ASSETS : VAT_DEDUCTIBLE
  return {
    lines: [line(posting.account, amountCents + vatCents - recoverable, 'base'), ...(recoverable > 0 ? [line(vatAccount, recoverable, 'vat')] : []), due],
    vatCents,
    vatBookedCents: vatCents,
    vatNote,
  }
}

/** Standard rate self-assessed when the category has none (CGI art. 278). */
const SELF_ASSESSED_RATE_BP = 2000

const PASSENGER_VEHICLE_NOTE = 'Véhicule de tourisme : TVA non récupérable (CGI ann. II art. 206, IV, 2, 6°)'

/** The counterpart lines of the entry, summing to the amount on the side opposite to the bank line. */
function buildPlainPostingLines(input: PostingInput): PostingPlan {
  const { category, posting, side, amountCents } = input
  const kind = input.kind ?? category.kind
  const line = (accountCode: string, cents: number, role: CounterpartLine['role']): CounterpartLine =>
    side === 'debit' ? { accountCode, debitCents: cents, creditCents: 0, role } : { accountCode, debitCents: 0, creditCents: cents, role }
  const single = (vatNote: string): PostingPlan => ({ lines: [line(posting.account, amountCents, 'base')], vatCents: 0, vatBookedCents: 0, vatNote })

  if (posting.vatRule === 'none' || kind === 'other') return single(RECOVERY_LABELS['no-vat'])
  if (posting.vatRule === 'self-assessed') return selfAssessedPlan(input, line)

  // Detected: only the VAT the bank read (an exempt operation taxed on option); otherwise the category's rate
  const vatCents =
    posting.vatRule === 'detected'
      ? (plausibleBankVat(amountCents, input.bankVatCents) ?? 0)
      : posting.vatRateBp <= 0
        ? 0
        : (plausibleBankVat(amountCents, input.bankVatCents) ?? vatIncludedCents(amountCents, posting.vatRateBp))
  if (vatCents <= 0) return single(posting.vatRule === 'detected' ? DETECTED_NONE_NOTE : RECOVERY_LABELS['no-vat'])

  if (kind === 'income') {
    if (input.franchise) return { ...single('Franchise en base de TVA : pas de TVA collectée (CGI art. 293 B)'), vatCents }
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
    const rule = posting.vatRule === 'detected' ? 'standard' : posting.vatRule
    const recovery = recoverableVatByRule(rule, { receiptKind: 'INVOICE', amountInclTaxCents: amountCents, vatCents, vatExempt: false })
    recoverable = recovery.recoverableVatCents
    vatNote = RECOVERY_LABELS[recovery.reason]
  }
  if (input.recoveryRatio !== null && recoverable > 0) {
    recoverable = deductibleVatCents(recoverable, input.recoveryRatio)
    vatNote = coefficientNote(input.recoveryRatio)
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
