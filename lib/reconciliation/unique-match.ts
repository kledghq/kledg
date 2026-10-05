/**
 * The one reconciliation Kledg can propose for a bank transaction without
 * any doubt, for the "Rapprocher" button of the MCP views
 * (docs/mcp-views.md). Built from what the reconciliation screens already
 * compute, in this order:
 *
 * 1. existing entries: a line (draft or validated entry) on the bank ledger
 *    account of the transaction's bank account (lib/banking/ledger-account.ts,
 *    never a "51" prefix), of the same amount to the cent on the opposite
 *    side, dated within one calendar day (lib/reconciliation/bank-line-match.ts,
 *    the rule of the auto-reconcile action), whose entry is not linked to a
 *    transaction yet. It is unique when exactly one such line exists for the
 *    transaction AND that line fits no other unreconciled transaction of the
 *    company. Several candidates: no match (the user chooses in Kledg); one
 *    or more candidates also stop step 2, so a rule never books a second
 *    entry for a payment that is already booked;
 * 2. else assignment rules: exactly one enabled rule matches the
 *    transaction and its entry can be computed (prefill.ts, ruleSuggestion).
 *    Two matching rules, even of different priorities: no match.
 *
 * Nothing is written here: the match only carries the ids and the
 * arguments of reconcile_transaction, which checks everything again.
 */

import { prisma } from '@/lib/prisma'
import { transactionOfCompany } from '@/lib/api/resources'
import { resolveBankAccountLedger } from '@/lib/banking/ledger-account'
import { loadRuleMatcher } from '@/lib/transactions/rule-service'
import { fromCents, toCents } from '@/lib/utils/money'
import { addUtcDays, formatIsoDateFr, isoDateToUtc, toIsoDateUtc } from '@/lib/utils/date'
import { bankLineCents, transactionMatchesBankLine } from './bank-line-match'
import { enrichTransaction, ruleSuggestion } from './prefill'
import { fiscalYearPeriods } from './service'
import { fiscalYearForDate, type FiscalYearPeriod } from './validation'

/** Arguments of reconcile_transaction for the match, without companyId. */
export type ReconcileArguments =
  | { transactionId: string; entryId: string }
  | {
      transactionId: string
      journalCode: string
      date: string
      description?: string
      reference?: string
      lines: Array<{ accountCode: string; debit?: number; credit?: number; label?: string }>
    }

export interface UniqueMatch {
  kind: 'entry' | 'rule'
  transactionId: string
  /** The existing entry (kind entry). */
  entryId: string | null
  /** Its bank line that matches the transaction (kind entry). */
  lineId: string | null
  /** The rule whose entry would be created as a draft (kind rule). */
  ruleId: string | null
  /** French description of the match. */
  label: string
  /** Signed amount in euros, like the transaction: money out negative. */
  amount: number
  /** Day of the existing entry, or of the entry the rule creates (yyyy-mm-dd). */
  date: string
  arguments: ReconcileArguments
}

/** Bound of the work per call: list_bank_transactions returns at most 200 rows. */
export const MAX_MATCHED_TRANSACTIONS = 200

const MAX_DESCRIPTION = 500
const DAY_MS = 86_400_000

const isDebit = (side: string) => side === 'debit' || side === 'Débit'
const signedEuros = (t: { amount: unknown; side: string }) => {
  const cents = Math.abs(toCents(t.amount as number) ?? 0)
  return fromCents(isDebit(t.side) ? -cents : cents)
}
const dayGap = (a: string, b: string) => Math.abs(isoDateToUtc(a).getTime() - isoDateToUtc(b).getTime()) / DAY_MS

/**
 * The unique match of each given transaction that has one, by transaction
 * id. Transactions that are reconciled, of another company or beyond
 * MAX_MATCHED_TRANSACTIONS are left out.
 */
export async function uniqueReconciliationMatches(companyId: string, transactionIds: readonly string[]): Promise<Map<string, UniqueMatch>> {
  const result = new Map<string, UniqueMatch>()
  const ids = [...new Set(transactionIds)].slice(0, MAX_MATCHED_TRANSACTIONS)
  if (ids.length === 0) return result

  const transactions = await prisma.bankTransaction.findMany({
    where: { id: { in: ids }, reconciled: false, ...transactionOfCompany(companyId) },
    include: { bankAccount: { select: { name: true, iban: true } } },
  })
  if (transactions.length === 0) return result

  const fiscalYears = await fiscalYearPeriods(companyId)
  const ledgerCache = new Map<string, Promise<string | null>>()
  const ledgerOf = (fiscalYear: FiscalYearPeriod, bankAccountId: string) => {
    const key = `${fiscalYear.id}:${bankAccountId}`
    let found = ledgerCache.get(key)
    if (!found) {
      found = resolveBankAccountLedger(companyId, fiscalYear.id, bankAccountId).then((a) => a?.id ?? null)
      ledgerCache.set(key, found)
    }
    return found
  }
  /** Bank ledger accounts a transaction's entry may sit on: those of the fiscal years of its day and the days around it. */
  const ledgersAround = async (day: string, bankAccountId: string): Promise<Set<string>> => {
    const accounts = new Set<string>()
    for (const offset of [-1, 0, 1]) {
      const fiscalYear = fiscalYearForDate(fiscalYears, toIsoDateUtc(addUtcDays(isoDateToUtc(day), offset)))
      if (!fiscalYear) continue
      const account = await ledgerOf(fiscalYear, bankAccountId)
      if (account) accounts.add(account)
    }
    return accounts
  }

  const days = transactions.map((t) => toIsoDateUtc(t.date)).sort()
  const from = addUtcDays(isoDateToUtc(days[0]), -1)
  const to = addUtcDays(isoDateToUtc(days[days.length - 1]), 2)

  // Every unreconciled transaction a candidate line could also fit (a line fits days within one day of its entry)
  const competitors = await prisma.bankTransaction.findMany({
    where: { ...transactionOfCompany(companyId), reconciled: false, date: { gte: addUtcDays(from, -1), lt: addUtcDays(to, 1) } },
    select: { id: true, date: true, amount: true, side: true, bankAccountId: true },
  })
  const scope = new Map<string, { id: string; day: string; amount: unknown; side: string; ledgers: Set<string> }>()
  for (const t of [...transactions, ...competitors]) {
    if (scope.has(t.id)) continue
    const day = toIsoDateUtc(t.date)
    scope.set(t.id, { id: t.id, day, amount: t.amount, side: t.side, ledgers: await ledgersAround(day, t.bankAccountId) })
  }

  const ledgerIds = [...new Set([...scope.values()].flatMap((t) => [...t.ledgers]))]
  const lines = ledgerIds.length
    ? await prisma.entryLine.findMany({
        where: { accountId: { in: ledgerIds }, accountingEntry: { companyId, date: { gte: from, lt: to } } },
        select: {
          id: true,
          debit: true,
          credit: true,
          accountId: true,
          accountingEntry: { select: { id: true, date: true, entryNumber: true, description: true, status: true } },
        },
      })
    : []
  const linked = lines.length
    ? new Set(
        (
          await prisma.bankTransaction.findMany({
            where: { ...transactionOfCompany(companyId), reconciledWith: { in: [...new Set(lines.map((l) => l.accountingEntry.id))] } },
            select: { reconciledWith: true },
          })
        ).map((t) => t.reconciledWith),
      )
    : new Set<string | null>()
  const candidates = lines
    .filter((l) => !linked.has(l.accountingEntry.id))
    .map((l) => ({ ...l, cents: bankLineCents(l), day: toIsoDateUtc(l.accountingEntry.date) }))
  const fits = (line: (typeof candidates)[number], t: { day: string; amount: unknown; side: string; ledgers: Set<string> }) =>
    t.ledgers.has(line.accountId) &&
    dayGap(line.day, t.day) <= 1 &&
    transactionMatchesBankLine(line.cents, { amount: t.amount as number, side: t.side })

  let matchRules: Awaited<ReturnType<typeof loadRuleMatcher>> | null = null
  for (const transaction of transactions) {
    const own = scope.get(transaction.id)!
    const found = candidates.filter((line) => fits(line, own))
    const amount = signedEuros(transaction)
    if (found.length > 0) {
      if (found.length > 1) continue
      const [line] = found
      const others = [...scope.values()].some((t) => t.id !== transaction.id && fits(line, t))
      if (others) continue
      const entry = line.accountingEntry
      const status = entry.status === 'draft' ? ', brouillon' : ''
      result.set(transaction.id, {
        kind: 'entry',
        transactionId: transaction.id,
        entryId: entry.id,
        lineId: line.id,
        ruleId: null,
        label: `Écriture n° ${entry.entryNumber} du ${formatIsoDateFr(line.day)}${status}${entry.description ? ` (${entry.description})` : ''}`.slice(0, 500),
        amount,
        date: line.day,
        arguments: { transactionId: transaction.id, entryId: entry.id },
      })
      continue
    }

    matchRules ??= await loadRuleMatcher(companyId)
    const matched = matchRules(enrichTransaction(transaction)).filter((m) => m.matched)
    if (matched.length !== 1) continue
    const rule = await ruleSuggestion(companyId, transaction, matched[0].ruleId)
    if (!rule) continue
    const description = rule.description.slice(0, MAX_DESCRIPTION)
    result.set(transaction.id, {
      kind: 'rule',
      transactionId: transaction.id,
      entryId: null,
      lineId: null,
      ruleId: matched[0].ruleId,
      label: `Règle « ${rule.ruleName} » : écriture en brouillon ${rule.suggestion.lines.map((l) => l.accountCode).join(', ')}`.slice(0, 500),
      amount,
      date: own.day,
      arguments: {
        transactionId: transaction.id,
        journalCode: rule.journalCode,
        date: own.day,
        ...(description && { description }),
        ...(rule.reference && { reference: rule.reference.slice(0, 200) }),
        lines: rule.suggestion.lines.map((l) => ({
          accountCode: l.accountCode,
          ...(l.debitCents > 0 && { debit: fromCents(l.debitCents) }),
          ...(l.creditCents > 0 && { credit: fromCents(l.creditCents) }),
          ...(l.description && { label: l.description.slice(0, 500) }),
        })),
      },
    })
  }
  return result
}
