/**
 * Suggestion engine of simple mode (docs/categories-simples.md): for a bank
 * transaction not yet reconciled, the category to propose, with a
 * confidence and a plain reason. Pure and deterministic: the same
 * transaction and the same signals always give the same suggestion. The
 * service (expenses-to-review.service.ts) gathers the signals from the
 * database; nothing here reads it.
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
 * 3. the built-in dictionary of French payees (payees.ts), routed by side
 *    and by the words that name the tax or the contribution;
 * 4. keywords of the label (restaurant, loyer, péage...);
 * 5. the category the bank gives (Qonto categories), mapped when it is
 *    unambiguous.
 * A category of the wrong direction (an income for money out, an expense
 * for money in) is never proposed. Below the medium threshold nothing is
 * proposed: the line is "à classer" and the user chooses. Kledg never
 * invents a category.
 *
 * Only high confidence lines without a question to answer can be confirmed
 * all at once ("Tout confirmer").
 */

import { findCategory, type Question, type SimpleCategory } from './categories'
import { bankText, KEYWORDS, matchDictionary, PAYEES } from './payees'
import { questionApplies, type Answers, type Side } from './posting'

export type Confidence = 'high' | 'medium' | 'low'
export type SuggestionSource = 'rule' | 'history' | 'payee' | 'keyword' | 'bank' | 'none'

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
}

export interface EngineContext {
  rule?: RuleSignal | null
  history: readonly HistoryChoice[]
}

export interface Suggestion {
  /** Category proposed; null: "à classer", or a rule without a category of the catalogue. */
  categoryId: string | null
  /** Rule whose lines are applied when the suggestion is confirmed as is. */
  ruleId: string | null
  ruleName: string | null
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

const SCORES = { rule: 0.95, historyRepeated: 0.92, historyOnce: 0.8, payeeHigh: 0.88, payeeMedium: 0.7, keywordHigh: 0.86, keywordMedium: 0.6, bank: 0.56 } as const

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

/** A category may be proposed for this side: no income for money out, no expense for money in. */
export function fitsSide(category: SimpleCategory, side: Side): boolean {
  return category.kind === 'other' || category.kind === (side === 'debit' ? 'expense' : 'income')
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

function fromHistory(history: readonly HistoryChoice[], side: Side): Candidate | null {
  const usable = history
    .filter((h) => {
      const category = findCategory(h.categoryId)
      return category !== null && fitsSide(category, side)
    })
    .slice()
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .slice(0, HISTORY_DEPTH)
  if (usable.length === 0) return null

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
  const keyword = matchDictionary(KEYWORDS, text, tx.side)
  if (keyword?.categoryId) {
    return {
      categoryId: keyword.categoryId,
      score: keyword.entry.confidence === 'high' ? SCORES.keywordHigh : SCORES.keywordMedium,
      source: 'keyword',
      reason: `Le libellé mentionne « ${keyword.matched.toLowerCase()} »`,
    }
  }
  return null
}

function fromBank(tx: EngineTransaction): Candidate | null {
  const mapped = tx.bankCategory ? BANK_CATEGORIES[tx.bankCategory] : undefined
  const categoryId = mapped ? (tx.side === 'debit' ? mapped.debit : mapped.credit) : undefined
  if (!categoryId) return null
  return { categoryId, score: SCORES.bank, source: 'bank', reason: 'Catégorie donnée par votre banque' }
}

const UNCLASSIFIED_REASON = 'À classer : choisissez la catégorie'

function finish(candidate: Candidate | null, tx: EngineTransaction): Suggestion {
  const none = (reason = UNCLASSIFIED_REASON): Suggestion => ({
    categoryId: null,
    ruleId: null,
    ruleName: null,
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
    else if (question.defaultAnswerId) answers[question.id] = question.defaultAnswerId
    else pendingQuestion = question
  }
  const confidence = confidenceOf(candidate.score)
  return {
    categoryId: category.id,
    ruleId: null,
    ruleName: null,
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
    )
  }
  const candidates = [fromHistory(context.history, tx.side), fromDictionary(tx), fromBank(tx)]
  // The first signal that names a category of the right direction with enough confidence wins.
  for (const candidate of candidates) {
    if (!candidate || candidate.categoryId === null) continue
    const category = findCategory(candidate.categoryId)
    if (category && fitsSide(category, tx.side) && candidate.score >= MEDIUM_CONFIDENCE) return finish(candidate, tx)
  }
  // A payee recognised without a category explains why the line stays to classify.
  const recognised = candidates.find((c) => c && c.categoryId === null)
  return finish(recognised ?? null, tx)
}
