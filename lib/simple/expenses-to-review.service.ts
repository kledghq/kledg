/**
 * "Dépenses à vérifier" of simple mode (docs/categories-simples.md): the
 * bank transactions not yet reconciled, each with the category Kledg
 * proposes (suggest.ts). This service gathers the signals of the engine
 * from the database, in a fixed number of queries whatever the number of
 * lines:
 * - the enabled transaction rules of the company, matched in memory
 *   (loadRuleMatcher, rule-matcher.ts) and mapped to the category of their
 *   main account;
 * - the history per normalized counterparty (counterpartyKey of
 *   lib/subscriptions/detect.ts): categories chosen in simple mode
 *   (simple_mode_entries), and the counterpart account of the transactions
 *   reconciled in expert mode (their entries' lines).
 *
 * Declined operations moved no money and are left out (as in the missing
 * receipts list). countExpensesToReview is what the simple home shows.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { transactionOfCompany } from '@/lib/api/resources'
import { counterpartyOf, enrichTransaction } from '@/lib/reconciliation/prefill'
import { fiscalYearPeriods, normalizeSide } from '@/lib/reconciliation/service'
import { checkEntryDate, isBankAccountCode, isVatAccount, type FiscalYearPeriod } from '@/lib/reconciliation/validation'
import { loadRuleMatcher } from '@/lib/transactions/rule-service'
import { pickRule } from '@/lib/transactions/rule-matcher'
import { counterpartyKey } from '@/lib/subscriptions/detect'
import { toCents } from '@/lib/utils/money'
import { addUtcDays, todayUtc, toIsoDateUtc } from '@/lib/utils/date'
import { categoryOfAccount, findCategory } from './categories'
import { displayNameOf } from './payees'
import { getSimpleModeSettings, type SimpleModeSettings } from './simple-mode-settings.service'
import { suggestCategory, type HistoryChoice, type RuleSignal, type Suggestion } from './suggest'
import type { Answers, Side } from './posting'

export const MAX_EXPENSES = 200
/** History read: the reconciliations of the last two years, at most this many. */
const HISTORY_ROWS = 2_000
const HISTORY_DAYS = 730

/** ?companyId=&side=&limit= */
export const ExpensesToReviewQuerySchema = z.object({
  side: z.enum(['debit', 'credit', 'all'], { error: 'Sens inconnu : debit, credit ou all' }).default('debit'),
  limit: z.coerce.number().int().min(1).max(MAX_EXPENSES).default(100),
})
export type ExpensesToReviewQuery = z.input<typeof ExpensesToReviewQuerySchema>

export interface ExpenseToReview {
  id: string
  /** yyyy-mm-dd */
  date: string
  side: Side
  /** Absolute amount in cents. */
  amountCents: number
  /** The payee as the user reads it ("Free Pro"). */
  name: string
  label: string | null
  suggestion: Suggestion
  /** The transaction has a receipt (attachment). */
  hasReceipt: boolean
  /** A receipt can be sent from Kledg (Qonto transactions). */
  canUploadReceipt: boolean
  /** Why it cannot be confirmed yet (no open fiscal year covers its date), null otherwise. */
  blockedReason: string | null
}

export interface ExpensesToReview {
  items: ExpenseToReview[]
  /** Every transaction to review on the side asked, beyond the rows returned. */
  count: number
  /** Lines "Tout confirmer" would confirm among the rows returned. */
  bulkConfirmableIds: string[]
  /** Whether confirmed entries wait for the accountant, and who they are (the page's footer). */
  review: SimpleModeSettings
}

/** Providers write the side "debit"/"credit" (older imports "Débit"/"Crédit"), as normalizeSide reads it. */
const DEBIT_SIDE = { side: { startsWith: 'd', mode: 'insensitive' as const } }
const sideFilter = (side: 'debit' | 'credit' | 'all') => (side === 'all' ? {} : side === 'debit' ? DEBIT_SIDE : { NOT: DEBIT_SIDE })

function toReviewWhere(companyId: string, side: 'debit' | 'credit' | 'all') {
  return {
    ...transactionOfCompany(companyId),
    reconciled: false,
    OR: [{ status: null }, { status: { not: 'declined' } }],
    ...sideFilter(side),
  }
}

/** The number of transactions still to review (money out by default): what the simple home shows. */
export async function countExpensesToReview(companyId: string, side: 'debit' | 'credit' | 'all' = 'debit'): Promise<number> {
  return prisma.bankTransaction.count({ where: toReviewWhere(companyId, side) })
}

/** Everything the engine reads besides the transaction, loaded once per request. */
export interface SuggestionSignals {
  rules: (transaction: Parameters<typeof enrichTransaction>[0]) => RuleSignal | null
  history: Map<string, HistoryChoice[]>
}

/** Category of a rule: the one of its first line that is neither bank nor VAT. */
function ruleCategory(lines: Array<{ accountCode: string }>): string | null {
  const main = lines.find((l) => !isBankAccountCode(l.accountCode) && !isVatAccount(l.accountCode))
  return main ? (categoryOfAccount(main.accountCode)?.id ?? null) : null
}

/** Loads the rules and the history of the company (three queries). */
export async function loadSuggestionSignals(companyId: string, now = new Date()): Promise<SuggestionSignals> {
  const [matcher, ruleRows, simpleRows] = await Promise.all([
    loadRuleMatcher(companyId),
    prisma.transactionRule.findMany({
      where: { companyId, enabled: true },
      select: { id: true, name: true, entryLines: { select: { accountCode: true }, orderBy: { order: 'asc' } } },
    }),
    prisma.simpleModeEntry.findMany({
      where: { companyId, categoryId: { not: null } },
      select: { counterpartyKey: true, categoryId: true, answers: true, bankTransactionId: true, entry: { select: { date: true } } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_ROWS,
    }),
  ])
  const ruleById = new Map(ruleRows.map((r) => [r.id, { name: r.name, categoryId: ruleCategory(r.entryLines) }]))

  const history = new Map<string, HistoryChoice[]>()
  const add = (key: string, choice: HistoryChoice) => {
    if (!key) return
    const list = history.get(key) ?? []
    list.push(choice)
    history.set(key, list)
  }
  const fromSimple = new Set<string>()
  for (const row of simpleRows) {
    if (row.bankTransactionId) fromSimple.add(row.bankTransactionId)
    add(row.counterpartyKey, { categoryId: row.categoryId!, answers: (row.answers as Answers | null) ?? null, day: toIsoDateUtc(row.entry.date) })
  }

  // Expert reconciliations: the counterpart account of the entry, mapped to a category
  const since = addUtcDays(todayUtc(now), -HISTORY_DAYS)
  const reconciled = await prisma.bankTransaction.findMany({
    where: { ...transactionOfCompany(companyId), reconciled: true, reconciledWith: { not: null }, date: { gte: since } },
    select: { id: true, date: true, label: true, counterpartyName: true, providerData: true, reconciledWith: true },
    orderBy: { date: 'desc' },
    take: HISTORY_ROWS,
  })
  const expert = reconciled.filter((t) => !fromSimple.has(t.id))
  const entryIds = expert.map((t) => t.reconciledWith!).filter(Boolean)
  const lines = entryIds.length
    ? await prisma.entryLine.findMany({
        where: { accountingEntryId: { in: entryIds } },
        select: { accountingEntryId: true, debit: true, credit: true, account: { select: { code: true } } },
      })
    : []
  const mainAccount = new Map<string, { code: string; cents: number }>()
  for (const line of lines) {
    const code = line.account.code
    if (isBankAccountCode(code) || isVatAccount(code)) continue
    const cents = Math.abs((toCents(line.debit) ?? 0) - (toCents(line.credit) ?? 0))
    const current = mainAccount.get(line.accountingEntryId)
    if (!current || cents > current.cents) mainAccount.set(line.accountingEntryId, { code, cents })
  }
  for (const t of expert) {
    const account = mainAccount.get(t.reconciledWith!)
    const category = account ? categoryOfAccount(account.code) : null
    if (!category) continue
    const name = counterpartyOf(t)
    add(counterpartyKey(name, t.label), { categoryId: category.id, day: toIsoDateUtc(t.date) })
  }

  return {
    history,
    rules: (transaction) => {
      const best = pickRule(matcher(enrichTransaction(transaction)).filter((m) => m.matched))
      const rule = best ? ruleById.get(best.ruleId) : undefined
      return best && rule ? { ruleId: best.ruleId, ruleName: rule.name, categoryId: rule.categoryId } : null
    },
  }
}

type LoadedTransaction = Parameters<typeof enrichTransaction>[0]

/** VAT the bank read on the receipt (Qonto), in cents, when it gives one. */
export function bankVatCentsOf(transaction: Pick<LoadedTransaction, 'vatAmount' | 'providerData'>): number | null {
  if (transaction.vatAmount != null) return toCents(transaction.vatAmount)
  const provider = transaction.providerData as { vat_amount?: number; vat_amount_cents?: number } | null
  if (provider?.vat_amount != null) return toCents(provider.vat_amount)
  return provider?.vat_amount_cents ?? null
}

/** The bank's own category of the transaction (Qonto). */
function bankCategoryOf(transaction: LoadedTransaction): string | null {
  const provider = transaction.providerData as { category?: string } | null
  return transaction.category ?? provider?.category ?? null
}

/** The engine's suggestion for one loaded transaction. */
export function suggestionFor(transaction: LoadedTransaction, signals: SuggestionSignals): Suggestion {
  const counterparty = counterpartyOf(transaction)
  return suggestCategory(
    {
      side: normalizeSide(transaction.side),
      amountCents: Math.abs(toCents(transaction.amount) ?? 0),
      label: transaction.label,
      counterpartyName: counterparty,
      bankCategory: bankCategoryOf(transaction),
      bankVatCents: bankVatCentsOf(transaction),
    },
    { rule: signals.rules(transaction), history: signals.history.get(counterpartyKey(counterparty, transaction.label)) ?? [] },
  )
}

function blockedReason(fiscalYears: FiscalYearPeriod[], day: string): string | null {
  const check = checkEntryDate(fiscalYears, day)
  if (!check.error) return null
  return check.fiscalYear === null && fiscalYears.some((fy) => fy.startDate <= day && day <= fy.endDate)
    ? "L'exercice de cette date est clôturé : votre comptable s'en occupe."
    : "Aucun exercice ouvert ne couvre cette date : votre comptable doit d'abord le créer."
}

/** The transactions to review with their suggestions, latest first. */
export async function listExpensesToReview(companyId: string, query: z.output<typeof ExpensesToReviewQuerySchema>): Promise<ExpensesToReview> {
  const where = toReviewWhere(companyId, query.side)
  const [rows, count, fiscalYears, signals, review] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      include: {
        bankAccount: { select: { name: true, iban: true, bankConnection: { select: { provider: true } } } },
        _count: { select: { attachments: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      take: query.limit,
    }),
    prisma.bankTransaction.count({ where }),
    fiscalYearPeriods(companyId),
    loadSuggestionSignals(companyId),
    getSimpleModeSettings(companyId),
  ])
  const items = rows.map((row): ExpenseToReview => {
    const date = toIsoDateUtc(row.date)
    const blocked = blockedReason(fiscalYears, date)
    const suggestion = suggestionFor(row, signals)
    return {
      id: row.id,
      date,
      side: normalizeSide(row.side),
      amountCents: Math.abs(toCents(row.amount) ?? 0),
      name: displayNameOf(counterpartyOf(row), row.label),
      label: row.label,
      suggestion: blocked ? { ...suggestion, bulkConfirmable: false } : suggestion,
      hasReceipt: row._count.attachments > 0,
      canUploadReceipt: row.bankAccount.bankConnection.provider === 'QONTO',
      blockedReason: blocked,
    }
  })
  return { items, count, bulkConfirmableIds: items.filter((i) => i.suggestion.bulkConfirmable).map((i) => i.id), review }
}

/** Label of a suggestion for messages: the category, or the rule. */
export function suggestionLabel(suggestion: Suggestion): string {
  return findCategory(suggestion.categoryId)?.label ?? (suggestion.ruleName ? `Règle « ${suggestion.ruleName} »` : 'À classer')
}
