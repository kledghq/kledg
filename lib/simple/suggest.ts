/**
 * Suggestion engine of simple mode (docs/categories-simples.md): for a bank
 * transaction not yet reconciled, the category to propose, with a
 * confidence and a plain reason. Pure and deterministic: the same
 * transaction and the same signals always give the same suggestion. The
 * service (expenses-to-review.service.ts) gathers the signals from the
 * database; nothing here reads it.
 *
 * Money in is first compared with the open sales invoices (match-invoice.ts):
 * a credit that pays one is proposed as the payment of that invoice, before
 * any category, so a sale already invoiced is never booked twice.
 *
 * Signals, in priority order (the first that gives a category wins):
 * 1. the company's transaction rules: the best matching rule (rule-matcher,
 *    highest priority then most specific). Its lines are applied as the
 *    rule says; the category shown is the one of its main account, when
 *    the catalogue has it;
 * 2. the company's history for the same normalized counterparty: the
 *    categories chosen in simple mode, and the accounts of the transactions
 *    reconciled in expert mode, latest first. The same choice the last
 *    times is a strong signal; diverging choices a weaker one;
 *    For money in from a supplier usually paid (history of expenses), the
 *    refund of that expense, at medium confidence at most;
 * 3. the built-in dictionary of French payees (payees.ts), routed by side
 *    and by the words that name the tax or the contribution; for money in
 *    whose label announces a refund (REMBOURSEMENT, AVOIR), the refund of
 *    what that payee is usually paid for;
 * 4. keywords of the label (restaurant, loyer, péage...);
 * 5. money in from a partner of the company (a physical shareholder's
 *    name): the question "Est-ce de l'argent que vous avez prêté à votre
 *    société ?" (current account, capital or sale);
 * 6. money in from a known customer (tiers): a sale, of the category of the
 *    customer's usual account;
 * 7. the category the bank gives (Qonto categories), mapped when it is
 *    unambiguous.
 * A category of the wrong direction (an income for money out, an expense
 * for money in) is never proposed. Below the medium threshold nothing is
 * proposed: the line is "à classer" and the user chooses. Kledg never
 * invents a category.
 *
 * Only high confidence lines without a question to answer can be confirmed
 * all at once ("Tout confirmer").
 */

import { findCategory, refundOf, type Question, type SimpleCategory } from './categories'
import { matchInvoice, significantWords, type OpenInvoice } from './match-invoice'
import { announcesRefund, bankText, KEYWORDS, matchDictionary, PAYEES } from './payees'
import { questionApplies, type Answers, type Side } from './posting'

export type Confidence = 'high' | 'medium' | 'low'
export type SuggestionSource = 'invoice' | 'rule' | 'history' | 'payee' | 'keyword' | 'owner' | 'customer' | 'bank' | 'none'

export interface EngineTransaction {
  side: Side
  /** Absolute amount, VAT included, in cents. */
  amountCents: number
  label: string | null
  counterpartyName: string | null
  /** Category given by the bank (Qonto `category`), if any. */
  bankCategory: string | null
  /** VAT read by the bank on the receipt, in cents. */
  bankVatCents?: number | null
}

/** The best transaction rule matching the transaction. */
export interface RuleSignal {
  ruleId: string
  ruleName: string
  /** Category of the rule's main account, null when the catalogue has none. */
  categoryId: string | null
}

/** A past choice for the same counterparty. */
export interface HistoryChoice {
  categoryId: string
  /** Answers given then (simple mode only). */
  answers?: Answers | null
  /** yyyy-mm-dd of the transaction. */
  day: string
  /**
   * Side of that transaction. Only choices made on the same side count: a
   * VAT payment says nothing about a VAT refund. Unknown: counts for both.
   */
  side?: Side
}

/** A customer of the company (tiers), with the category of its usual revenue account. */
export interface CustomerSignal {
  name: string
  categoryId: string | null
}

export interface EngineContext {
  rule?: RuleSignal | null
  history: readonly HistoryChoice[]
  /** Open sales invoices, for money in. */
  invoices?: readonly OpenInvoice[]
  /** Names of the partners of the company (physical shareholders). */
  owners?: readonly string[]
  /** Customers of the company. */
  customers?: readonly CustomerSignal[]
  /**
   * The company is taxed at the impôt sur le revenu on the transaction day:
   * who a meal was with changes what is deductible (meal of the exploitant,
   * lib/expense-reports/exploitant-meals.ts), so the meal question has no
   * default and is asked.
   */
  askMealGuests?: boolean
}

/** The open invoice a credit pays, as proposed. */
export interface InvoiceSuggestion {
  invoiceId: string
  number: string
  customerName: string
  /** Left to pay on the invoice before this credit. */
  remainingCents: number
  /** The credit pays part of it. */
  partial: boolean
}

export interface Suggestion {
  /** Category proposed; null: "à classer", or a rule without a category of the catalogue. */
  categoryId: string | null
  /** Rule whose lines are applied when the suggestion is confirmed as is. */
  ruleId: string | null
  ruleName: string | null
  /** Open sales invoice the credit pays: confirming records the payment. */
  invoice: InvoiceSuggestion | null
  confidence: Confidence
  /** 0 to 1, for ordering and tests; the confidence is what the UI shows. */
  score: number
  source: SuggestionSource
  /** Plain French reason shown under the category. */
  reason: string
  /** Answers already known (a vehicle answered for this counterparty before, or the question's default). */
  answers: Answers
  /** The question to answer before confirming, null when none. */
  pendingQuestion: Question | null
  /** High confidence and nothing to answer. */
  bulkConfirmable: boolean
}

export const HIGH_CONFIDENCE = 0.85
export const MEDIUM_CONFIDENCE = 0.55

const SCORES = { rule: 0.95, historyRepeated: 0.92, historyOnce: 0.8, payeeHigh: 0.88, payeeMedium: 0.7, keywordHigh: 0.86, keywordMedium: 0.6, owner: 0.75, customer: 0.7, refund: 0.7, bank: 0.56 } as const

/** How many of the latest choices are looked at. */
const HISTORY_DEPTH = 6

/**
 * Qonto transaction categories that name one category of the catalogue.
 * Others (other_expense, online_service, refund, sales...) say too little.
 */
export const BANK_CATEGORIES: Readonly<Record<string, { debit?: string; credit?: string }>> = {
  restaurant_and_bar: { debit: 'repas-affaires' },
  transport: { debit: 'deplacements' },
  hotel_and_lodging: { debit: 'hotel' },
  gas_station: { debit: 'carburant' },
  utility: { debit: 'energie' },
  insurance: { debit: 'assurances' },
  legal_and_accounting: { debit: 'honoraires' },
  office_supply: { debit: 'fournitures' },
  hardware_and_equipment: { debit: 'materiel-informatique' },
  it_and_electronics: { debit: 'materiel-informatique' },
  marketing: { debit: 'publicite' },
  logistics: { debit: 'livraisons' },
  office_rental: { debit: 'loyer' },
  subscription: { debit: 'logiciels' },
  fees: { debit: 'frais-bancaires' },
  salary: { debit: 'salaires' },
  atm: { debit: 'retrait-especes' },
  treasury_and_interco: { debit: 'virement-interne', credit: 'virement-interne' },
}

function confidenceOf(score: number): Confidence {
  if (score >= HIGH_CONFIDENCE) return 'high'
  if (score >= MEDIUM_CONFIDENCE) return 'medium'
  return 'low'
}

/** A category may be proposed for this side: no income nor refund for money out, no expense for money in. */
export function fitsSide(category: SimpleCategory, side: Side): boolean {
  if (category.kind === 'other') return true
  return side === 'debit' ? category.kind === 'expense' : category.kind === 'income' || category.kind === 'refund'
}

interface Candidate {
  categoryId: string | null
  score: number
  source: SuggestionSource
  reason: string
  ruleId?: string
  ruleName?: string
  answers?: Answers | null
}

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one)

/**
 * Money in from a payee whose payments were classified as expenses: the
 * refund of the latest of them, never more than medium confidence (a
 * supplier may also be a customer).
 */
function refundFromHistory(history: readonly HistoryChoice[]): Candidate | null {
  const latest = history
    .filter((h) => findCategory(h.categoryId)?.kind === 'expense' && refundOf(h.categoryId) !== null)
    .slice()
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))[0]
  if (!latest) return null
  const expense = findCategory(latest.categoryId)!
  return {
    categoryId: refundOf(latest.categoryId)!.id,
    score: SCORES.refund,
    source: 'history',
    reason: `Remboursement d’un fournisseur que vous classez en « ${expense.label} »`,
    answers: latest.answers,
  }
}

function fromHistory(history: readonly HistoryChoice[], side: Side): Candidate | null {
  const usable = history
    .filter((h) => {
      const category = findCategory(h.categoryId)
      return category !== null && fitsSide(category, side) && (h.side === undefined || h.side === side)
    })
    .slice()
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .slice(0, HISTORY_DEPTH)
  if (usable.length === 0) return side === 'credit' ? refundFromHistory(history) : null

  const latest = usable[0]
  let streak = 0
  while (streak < usable.length && usable[streak].categoryId === latest.categoryId) streak++
  if (streak === usable.length) {
    return {
      categoryId: latest.categoryId,
      score: streak >= 2 ? SCORES.historyRepeated : SCORES.historyOnce,
      source: 'history',
      reason: streak >= 2 ? `Comme les ${streak} dernières fois` : 'Comme la dernière fois',
      answers: latest.answers,
    }
  }
  // Diverging choices: the most frequent, weighted by its share
  const counts = new Map<string, number>()
  for (const h of usable) counts.set(h.categoryId, (counts.get(h.categoryId) ?? 0) + 1)
  const [categoryId, count] = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === latest.categoryId ? -1 : b[0] === latest.categoryId ? 1 : 0))[0]
  const score = SCORES.historyOnce * (count / usable.length)
  return {
    categoryId,
    score,
    source: 'history',
    reason: `Choisi ${count} ${plural(count, 'fois', 'fois')} sur les ${usable.length} derniers paiements`,
    answers: usable.find((h) => h.categoryId === categoryId)?.answers,
  }
}

function fromDictionary(tx: EngineTransaction): Candidate | null {
  const text = bankText(tx.counterpartyName, tx.label)
  const payee = matchDictionary(PAYEES, text, tx.side)
  if (payee) {
    if (payee.categoryId === null) {
      return { categoryId: null, score: 0, source: 'payee', reason: payee.entry.hint ?? `Reconnu : ${payee.entry.name}, à classer` }
    }
    return {
      categoryId: payee.categoryId,
      score: payee.entry.confidence === 'high' ? SCORES.payeeHigh : SCORES.payeeMedium,
      source: 'payee',
      reason: `Reconnu : ${payee.entry.name}`,
    }
  }
  const refund = tx.side === 'credit' && announcesRefund(text)
  if (refund) {
    // A supplier gives money back: the refund of what it is usually paid for
    const paid = matchDictionary(PAYEES, text, 'debit')
    const category = refundOf(paid?.categoryId)
    if (paid && category) return { categoryId: category.id, score: SCORES.refund, source: 'payee', reason: `Remboursement reconnu : ${paid.entry.name}` }
  }
  const keyword = matchDictionary(KEYWORDS, text, tx.side)
  if (keyword?.categoryId) {
    return {
      categoryId: keyword.categoryId,
      score: keyword.entry.confidence === 'high' ? SCORES.keywordHigh : SCORES.keywordMedium,
      source: 'keyword',
      reason: `Le libellé mentionne « ${keyword.matched.toLowerCase()} »`,
    }
  }
  if (keyword && keyword.categoryId === null && keyword.entry.hint) return { categoryId: null, score: 0, source: 'keyword', reason: keyword.entry.hint }
  if (refund) {
    const paid = matchDictionary(KEYWORDS, text, 'debit')
    const category = refundOf(paid?.categoryId)
    if (paid && category) return { categoryId: category.id, score: SCORES.keywordMedium, source: 'keyword', reason: `Remboursement : le libellé mentionne « ${paid.matched.toLowerCase()} »` }
    return { categoryId: null, score: 0, source: 'payee', reason: 'Remboursement : choisissez la dépense qui vous est remboursée.' }
  }
  return null
}

/** Whole words of the bank line naming a person or a company (significant words of the name, match-invoice.ts). */
function names(text: string, name: string): boolean {
  const significant = significantWords(name)
  return significant.length > 0 && significant.every((w) => text.includes(` ${w} `))
}

/** Money in from a partner of the company: what it is depends on a question. */
function fromOwner(tx: EngineTransaction, owners: readonly string[] | undefined): Candidate | null {
  if (tx.side !== 'credit' || !owners?.length) return null
  const text = bankText(tx.counterpartyName, tx.label)
  const owner = owners.find((name) => names(text, name))
  return owner ? { categoryId: 'versement-associe', score: SCORES.owner, source: 'owner', reason: `Virement de ${owner}, associé de la société` } : null
}

/** Money in from a known customer: a sale. */
function fromCustomer(tx: EngineTransaction, customers: readonly CustomerSignal[] | undefined): Candidate | null {
  if (tx.side !== 'credit' || !customers?.length) return null
  const text = bankText(tx.counterpartyName, tx.label)
  const customer = customers.find((c) => names(text, c.name))
  if (!customer) return null
  const category = findCategory(customer.categoryId)
  return {
    categoryId: category && category.kind === 'income' ? category.id : 'ventes-prestations',
    score: SCORES.customer,
    source: 'customer',
    reason: `Votre client ${customer.name}`,
  }
}

function fromBank(tx: EngineTransaction): Candidate | null {
  const mapped = tx.bankCategory ? BANK_CATEGORIES[tx.bankCategory] : undefined
  const categoryId = mapped ? (tx.side === 'debit' ? mapped.debit : mapped.credit) : undefined
  if (!categoryId) return null
  return { categoryId, score: SCORES.bank, source: 'bank', reason: 'Catégorie donnée par votre banque' }
}

const UNCLASSIFIED_REASON = 'À classer : choisissez la catégorie'

function finish(candidate: Candidate | null, tx: EngineTransaction, askMealGuests = false): Suggestion {
  const none = (reason = UNCLASSIFIED_REASON): Suggestion => ({
    categoryId: null,
    ruleId: null,
    ruleName: null,
    invoice: null,
    confidence: 'low',
    score: candidate?.score ?? 0,
    source: 'none',
    reason,
    answers: {},
    pendingQuestion: null,
    bulkConfirmable: false,
  })
  if (!candidate) return none()

  // A rule applies its own lines, with or without a category of the catalogue.
  if (candidate.source === 'rule') {
    return {
      categoryId: candidate.categoryId,
      ruleId: candidate.ruleId ?? null,
      ruleName: candidate.ruleName ?? null,
      invoice: null,
      confidence: confidenceOf(candidate.score),
      score: candidate.score,
      source: 'rule',
      reason: candidate.reason,
      answers: {},
      pendingQuestion: null,
      bulkConfirmable: candidate.score >= HIGH_CONFIDENCE,
    }
  }

  const category = findCategory(candidate.categoryId)
  if (!category || candidate.score < MEDIUM_CONFIDENCE) return none(candidate.categoryId === null ? candidate.reason : UNCLASSIFIED_REASON)

  const answers: Answers = {}
  let pendingQuestion: Question | null = null
  const question = category.question
  if (question && questionApplies(category, tx.amountCents, tx.bankVatCents)) {
    const known = question.reusable ? candidate.answers?.[question.id] : undefined
    if (known && question.answers.some((a) => a.id === known)) answers[question.id] = known
    else if (question.defaultAnswerId && !(askMealGuests && question.id === 'meal-guests')) answers[question.id] = question.defaultAnswerId
    else pendingQuestion = question
  }
  const confidence = confidenceOf(candidate.score)
  return {
    categoryId: category.id,
    ruleId: null,
    ruleName: null,
    invoice: null,
    confidence,
    score: candidate.score,
    source: candidate.source,
    reason: pendingQuestion ? 'Une question avant de classer' : candidate.reason,
    answers,
    pendingQuestion,
    bulkConfirmable: confidence === 'high' && pendingQuestion === null,
  }
}

/** The suggestion for one transaction. */
export function suggestCategory(tx: EngineTransaction, context: EngineContext): Suggestion {
  // Money in that pays an open sales invoice is that payment, whatever else says.
  const invoice = tx.side === 'credit' && context.invoices?.length ? matchInvoice(tx, context.invoices) : null
  if (invoice) {
    const confidence = confidenceOf(invoice.score)
    return {
      categoryId: null,
      ruleId: null,
      ruleName: null,
      invoice: { invoiceId: invoice.invoiceId, number: invoice.number, customerName: invoice.customerName, remainingCents: invoice.remainingCents, partial: invoice.partial },
      confidence,
      score: invoice.score,
      source: 'invoice',
      reason: invoice.reason,
      answers: {},
      pendingQuestion: null,
      bulkConfirmable: confidence === 'high',
    }
  }
  if (context.rule) {
    const category = findCategory(context.rule.categoryId)
    return finish(
      {
        categoryId: category && fitsSide(category, tx.side) ? category.id : null,
        score: SCORES.rule,
        source: 'rule',
        reason: `Votre règle « ${context.rule.ruleName} »`,
        ruleId: context.rule.ruleId,
        ruleName: context.rule.ruleName,
      },
      tx,
      context.askMealGuests,
    )
  }
  const candidates = [fromHistory(context.history, tx.side), fromDictionary(tx), fromOwner(tx, context.owners), fromCustomer(tx, context.customers), fromBank(tx)]
  // The first signal that names a category of the right direction with enough confidence wins.
  for (const candidate of candidates) {
    if (!candidate || candidate.categoryId === null) continue
    const category = findCategory(candidate.categoryId)
    if (category && fitsSide(category, tx.side) && candidate.score >= MEDIUM_CONFIDENCE) return finish(candidate, tx, context.askMealGuests)
  }
  // A payee recognised without a category explains why the line stays to classify.
  const recognised = candidates.find((c) => c && c.categoryId === null)
  return finish(recognised ?? null, tx, context.askMealGuests)
}
