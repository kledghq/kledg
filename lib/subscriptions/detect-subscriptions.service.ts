/**
 * Detected subscriptions of a company (docs/abonnements.md): the recurring
 * debits of its bank lines (lib/subscriptions/detect.ts), each with the
 * decision a user took about it and the class 6 account of its latest
 * reconciled payment, to suggest a budget line.
 *
 * A payment reconciled with an entry (bank_transactions.reconciledWith, set
 * by lib/reconciliation/service.ts) is classified by the counterpart of the
 * bank line in that entry: the account debited with the largest amount
 * outside class 5. Salaries (42), social bodies (43), the State (44),
 * associates (455) and loans (16) make the series a recurring charge, not a
 * subscription; any other account (rent 613, insurance 616, a supplier)
 * makes it a subscription. Detection runs once to find the series, the
 * entries of their payments are read, then it runs again with the classes:
 * grouping never depends on them, so the series are the same.
 *
 * Detection runs at each read and is never stored: it depends on lines that
 * a sync, an import or a deletion change at any time, and it reads a few
 * thousand rows at most. Only decisions are stored (subscription_decisions).
 *
 * Every query is scoped by company; bank connection credentials are never
 * selected.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { transactionOfCompany } from '@/lib/api/resources'
import { normalizeSide } from '@/lib/reconciliation/service'
import { addIsoDays, calendarDayOf, isoDateToUtc, todayUtc, toIsoDateUtc } from '@/lib/utils/date'
import { toCents } from '@/lib/utils/money'
import { detectSubscriptions, ledgerChargeReason, matchDecisions, type BankLine, type DetectedSubscription, type SubscriptionCadence } from './detect'

export const SUBSCRIPTION_NOT_FOUND = 'Abonnement introuvable : actualisez la page, les opérations bancaires ont pu changer.'

/** Three years of lines: enough for two yearly payments and the rhythm of the others. */
const LOOKBACK_DAYS = 3 * 366
/** Most recent lines read at most (a busy account has a few thousand a year). */
const MAX_LINES = 20_000
/** Bank statuses of lines that never left the account. */
const NOT_PAID_STATUSES = ['declined', 'canceled', 'cancelled', 'reversed']

export type DecisionStatus = 'confirmed' | 'ignored'

export interface SubscriptionDecisionView {
  id: string
  status: DecisionStatus
  budgetLine: { id: string; accountPrefix: string; label: string; fiscalYear: number } | null
  decidedAt: string
}

export interface SubscriptionView extends DetectedSubscription {
  decision: SubscriptionDecisionView | null
  /**
   * Counted among the subscriptions (page, totals): a subscription not
   * ignored, or a recurring charge a user confirmed as a subscription.
   */
  countsAsSubscription: boolean
  /** Class 6 account of the latest payment reconciled with an entry, to pick a budget line. */
  suggestedAccountCode: string | null
  /** Latest payment, to prefill an assignment rule (règle d'affectation). */
  lastTransactionId: string
}

export interface SubscriptionList {
  today: string
  /** Last day the bank lines cover: an overdue payment is judged at that day. */
  observedUntil: string | null
  items: SubscriptionView[]
  /** Subscriptions counted as such, neither ignored nor possibly stopped, and their yearly cost (recurring charges left out). */
  totals: { activeCount: number; activeAnnualizedCents: number }
}

const DECISION_SELECT = {
  id: true,
  counterpartyKey: true,
  cadence: true,
  referenceAmount: true,
  status: true,
  updatedAt: true,
  budgetLine: { select: { id: true, accountPrefix: true, label: true, budget: { select: { fiscalYear: { select: { year: true } } } } } },
} as const satisfies Prisma.SubscriptionDecisionSelect

type DecisionRow = Prisma.SubscriptionDecisionGetPayload<{ select: typeof DECISION_SELECT }>

export const toDbCadence = (cadence: SubscriptionCadence) => cadence.toUpperCase() as Uppercase<SubscriptionCadence>
const fromDbCadence = (cadence: string) => cadence.toLowerCase() as SubscriptionCadence

function decisionView(row: DecisionRow): SubscriptionDecisionView {
  return {
    id: row.id,
    status: row.status === 'CONFIRMED' ? 'confirmed' : 'ignored',
    budgetLine: row.budgetLine
      ? { id: row.budgetLine.id, accountPrefix: row.budgetLine.accountPrefix, label: row.budgetLine.label, fiscalYear: row.budgetLine.budget.fiscalYear.year }
      : null,
    decidedAt: row.updatedAt.toISOString(),
  }
}

/** Bank lines of the company over the lookback window, with the entry each one is reconciled with. */
async function loadBankLines(companyId: string, today: string) {
  const rows = await prisma.bankTransaction.findMany({
    where: {
      ...transactionOfCompany(companyId),
      date: { gte: isoDateToUtc(addIsoDays(today, -LOOKBACK_DAYS)), lt: isoDateToUtc(addIsoDays(today, 1)) },
      OR: [{ status: null }, { status: { notIn: NOT_PAID_STATUSES } }],
    },
    select: { id: true, date: true, amount: true, side: true, label: true, counterpartyName: true, reconciledWith: true },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: MAX_LINES,
  })
  const lines: BankLine[] = []
  const entryOf = new Map<string, string>()
  for (const row of rows) {
    const day = calendarDayOf(row.date)
    const cents = toCents(row.amount)
    if (!day || cents === null) continue
    lines.push({ id: row.id, day, amountCents: Math.abs(cents), side: normalizeSide(row.side), label: row.label, counterpartyName: row.counterpartyName })
    if (row.reconciledWith) entryOf.set(row.id, row.reconciledWith)
  }
  return { lines, entryOf }
}

interface EntryAccounts {
  /** Counterpart of the bank line: the account debited with the largest amount outside class 5. */
  counterpart: string | null
  /** Class 6 account debited with the largest amount, to suggest a budget line. */
  charge: string | null
}

/** Accounts debited by each entry of the company, for the entries given. */
async function accountsOfEntries(companyId: string, entryIds: string[]): Promise<Map<string, EntryAccounts>> {
  if (entryIds.length === 0) return new Map()
  const lines = await prisma.entryLine.findMany({
    where: { accountingEntryId: { in: entryIds }, accountingEntry: { companyId }, debit: { gt: 0 }, NOT: { account: { code: { startsWith: '5' } } } },
    select: { accountingEntryId: true, debit: true, account: { select: { code: true } } },
  })
  const largest = (current: { code: string; cents: number } | undefined, code: string, cents: number) =>
    !current || cents > current.cents || (cents === current.cents && code < current.code) ? { code, cents } : current
  const counterpart = new Map<string, { code: string; cents: number }>()
  const charge = new Map<string, { code: string; cents: number }>()
  for (const line of lines) {
    const cents = toCents(line.debit) ?? 0
    const code = line.account.code
    counterpart.set(line.accountingEntryId, largest(counterpart.get(line.accountingEntryId), code, cents))
    if (code.startsWith('6')) charge.set(line.accountingEntryId, largest(charge.get(line.accountingEntryId), code, cents))
  }
  return new Map(entryIds.map((id) => [id, { counterpart: counterpart.get(id)?.code ?? null, charge: charge.get(id)?.code ?? null }]))
}

/**
 * The subscriptions detected in the company's bank lines as of `today`
 * (today in UTC by default), with their decisions. Ignored ones are
 * included, flagged by their decision.
 */
export async function listDetectedSubscriptions(companyId: string, options: { today?: string } = {}): Promise<SubscriptionList> {
  const today = options.today ?? toIsoDateUtc(todayUtc())
  const [{ lines, entryOf }, decisions] = await Promise.all([
    loadBankLines(companyId, today),
    prisma.subscriptionDecision.findMany({ where: { companyId }, select: DECISION_SELECT, orderBy: { id: 'asc' } }),
  ])
  // First pass: the series; then the entries of their reconciled payments; second pass with the account classes
  const firstPass = detectSubscriptions(lines, { today })
  const entryIds = new Set(firstPass.subscriptions.flatMap((s) => s.transactionIds.map((id) => entryOf.get(id)).filter((id): id is string => !!id)))
  const accountsOfEntry = await accountsOfEntries(companyId, [...entryIds])
  const classified = lines.map((line) => {
    const counterpart = accountsOfEntry.get(entryOf.get(line.id) ?? '')?.counterpart
    return counterpart ? { ...line, ledgerClass: ledgerChargeReason(counterpart) } : line
  })
  const { observedUntil, subscriptions } = detectSubscriptions(classified, { today })

  const matched = matchDecisions(
    subscriptions,
    decisions.map((d) => ({ id: d.id, counterpartyKey: d.counterpartyKey, cadence: fromDbCadence(d.cadence), referenceAmountCents: toCents(d.referenceAmount) ?? 0 })),
  )
  const decisionById = new Map(decisions.map((d) => [d.id, d]))

  const items = subscriptions.map((s): SubscriptionView => {
    const decisionId = matched.get(s.id)
    const decision = decisionId ? decisionById.get(decisionId) : undefined
    const charge = [...s.transactionIds].reverse().map((id) => accountsOfEntry.get(entryOf.get(id) ?? '')?.charge).find(Boolean)
    const view = decision ? decisionView(decision) : null
    return {
      ...s,
      decision: view,
      countsAsSubscription: s.kind === 'subscription' ? view?.status !== 'ignored' : view?.status === 'confirmed',
      suggestedAccountCode: charge ?? null,
      lastTransactionId: s.transactionIds[s.transactionIds.length - 1],
    }
  })
  const active = items.filter((s) => s.countsAsSubscription && s.status !== 'possibly_stopped')
  return {
    today,
    observedUntil,
    items,
    totals: { activeCount: active.length, activeAnnualizedCents: active.reduce((sum, s) => sum + s.annualizedCents, 0) },
  }
}

/** One detected subscription of the company by id (404 when the lines no longer show it). */
export async function getDetectedSubscription(companyId: string, subscriptionId: string, options: { today?: string } = {}): Promise<SubscriptionView> {
  const { items } = await listDetectedSubscriptions(companyId, options)
  const found = items.find((s) => s.id === subscriptionId)
  if (!found) throw new NotFoundError(SUBSCRIPTION_NOT_FOUND)
  return found
}
