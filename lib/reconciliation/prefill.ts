/**
 * Suggested counterpart lines for the reconciliation dialog, in order:
 * 1. the best matching transaction rule (its computed entry),
 * 2. else the last reconciled transaction with the same counterparty (its
 *    accounts and VAT rate, scaled to this amount).
 * Suggestions use account codes: the dialog maps them to the accounts of the
 * fiscal year of the entry date. They are never written without the user.
 */

import type { BankTransaction } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { findMatchingRules } from '@/lib/transactions/rule-service'
import { prepareRuleEntry } from '@/lib/transactions/rule-executor'
import type { EnrichedTransaction } from '@/lib/transactions/types'
import { toCents } from '@/lib/utils/money'
import { formatIsoDateFr, toIsoDateUtc } from '@/lib/utils/date'
import { transactionOfCompany } from '@/lib/api/resources'
import {
  bankLineOf,
  checkVat,
  isBankAccountCode,
  isCollectedVatAccount,
  isDeductibleVatAccount,
  type BankSide,
} from './validation'
import type { Suggestion } from './types'

export type { Suggestion, SuggestedLine } from './types'

type Transaction = BankTransaction & { bankAccount: { name: string; iban: string | null } }

/** Counterparty name: the provider's cleaned name, kept on the row since the Qonto sync. */
export function counterpartyOf(transaction: Pick<BankTransaction, 'counterpartyName' | 'providerData'>): string | null {
  const provider = transaction.providerData as { clean_counterparty_name?: string } | null
  return transaction.counterpartyName?.trim() || provider?.clean_counterparty_name?.trim() || null
}

/** The transaction as the rule matcher reads it: counterparty, bank categories and operation type from the provider data. */
export function enrichTransaction(transaction: Transaction): EnrichedTransaction {
  const provider = (transaction.providerData ?? {}) as Record<string, unknown>
  const name = (key: string) => ((provider[key] as { name?: string } | null | undefined)?.name ?? null)
  return {
    ...transaction,
    logoUrl: transaction.logoUrl,
    counterpartyName: counterpartyOf(transaction),
    category: transaction.category ?? ((provider.category as string | undefined) || null),
    cashflowCategory: transaction.cashflowCategory ?? name('cashflow_category'),
    cashflowSubcategory: transaction.cashflowSubcategory ?? name('cashflow_subcategory'),
    operationType: transaction.operationType ?? ((provider.operation_type as string | undefined) || null),
  }
}

/** French VAT rates (CGI art. 278 to 281 nonies, Corse and DOM rates included). */
const KNOWN_VAT_RATES = [20, 13, 10, 8.5, 5.5, 2.1, 1.75, 1.05, 0.9]

/** VAT rate implied by lines (deductible or collected VAT over the tax-free base), snapped to a legal rate. */
export function vatRateOf(lines: Array<{ accountCode: string; debitCents: number; creditCents: number }>): number | null {
  const { vatCents, baseCents } = checkVat(lines.map((l) => ({ ...l, accountId: l.accountCode })))
  if (vatCents === 0 || baseCents === 0) return null
  const rate = (vatCents * 100) / baseCents
  const known = KNOWN_VAT_RATES.find((r) => Math.abs(r - rate) <= 0.2)
  return known ?? Math.round(rate * 10) / 10
}

/**
 * Scales signed amounts (debit positive) so they sum exactly to `target`,
 * keeping their proportions; rounding goes to the largest line. BigInt keeps
 * the products exact for any Decimal(15, 2) amount.
 */
export function scaleNets(nets: number[], target: number): number[] {
  const total = nets.reduce((s, n) => s + n, 0)
  if (total === 0) return nets.map(() => 0)
  const ZERO = BigInt(0)
  const TWO = BigInt(2)
  const abs = (v: bigint) => (v < ZERO ? -v : v)
  /** num / den rounded half away from zero. */
  const divide = (num: bigint, den: bigint) => {
    const q = (abs(num) * TWO + abs(den)) / (TWO * abs(den))
    return (num < ZERO) !== (den < ZERO) ? -q : q
  }
  const scaled = nets.map((n) => Number(divide(BigInt(n) * BigInt(target), BigInt(total))))
  const residue = target - scaled.reduce((s, n) => s + n, 0)
  if (residue !== 0) {
    let largest = 0
    scaled.forEach((n, i) => {
      if (Math.abs(n) > Math.abs(scaled[largest])) largest = i
    })
    scaled[largest] += residue
  }
  return scaled
}

async function fromRule(companyId: string, transaction: Transaction): Promise<Suggestion | null> {
  const matches = (await findMatchingRules(companyId, enrichTransaction(transaction))).filter((m) => m.matched)
  // Highest confidence first; the matcher already orders by rule priority
  matches.sort((a, b) => b.confidence - a.confidence)
  for (const match of matches) {
    const prepared = await prepareRuleEntry(match.ruleId, transaction.id, companyId)
    if (!prepared.ok) continue
    const accounts = await prisma.account.findMany({
      where: { id: { in: prepared.lines.map((l) => l.accountId) }, companyId },
      select: { id: true, code: true, label: true },
    })
    const byId = new Map(accounts.map((a) => [a.id, a]))
    const lines = prepared.lines
      .filter((l) => l.accountId !== prepared.bankAccountId && !isBankAccountCode(byId.get(l.accountId)?.code ?? '51'))
      .map((l) => ({
        accountCode: byId.get(l.accountId)!.code,
        accountLabel: byId.get(l.accountId)!.label,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        description: l.description ?? null,
      }))
    if (lines.length === 0) continue
    return {
      source: 'rule',
      title: `Suggestion de la règle « ${prepared.ruleName} »`,
      ruleId: match.ruleId,
      vatRatePercent: vatRateOf(lines),
      lines,
    }
  }
  return null
}

async function fromHistory(companyId: string, transaction: Transaction): Promise<Suggestion | null> {
  const counterparty = counterpartyOf(transaction)
  if (!counterparty) return null

  const previous = await prisma.bankTransaction.findMany({
    where: {
      ...transactionOfCompany(companyId),
      id: { not: transaction.id },
      reconciled: true,
      reconciledWith: { not: null },
      counterpartyName: { equals: counterparty, mode: 'insensitive' },
    },
    orderBy: [{ date: 'desc' }, { reconciledAt: 'desc' }],
    take: 5,
    select: { id: true, date: true, reconciledWith: true },
  })

  const side: BankSide = transaction.side.toLowerCase().startsWith('d') ? 'debit' : 'credit'
  const bank = bankLineOf({ amountCents: toCents(transaction.amount) ?? 0, side })
  // Counterparts carry the opposite of the bank line
  const target = bank.creditCents - bank.debitCents

  for (const candidate of previous) {
    const entry = await prisma.accountingEntry.findFirst({
      where: { id: candidate.reconciledWith!, companyId },
      select: { lines: { select: { debit: true, credit: true, description: true, account: { select: { code: true, label: true } } } } },
    })
    if (!entry) continue
    const counterparts = entry.lines
      .filter((l) => !isBankAccountCode(l.account.code))
      .map((l) => ({ ...l, net: (toCents(l.debit) ?? 0) - (toCents(l.credit) ?? 0) }))
      .filter((l) => l.net !== 0)
    if (counterparts.length === 0 || counterparts.reduce((s, l) => s + l.net, 0) === 0) continue

    const scaled = scaleNets(counterparts.map((l) => l.net), target)
    const lines = counterparts
      .map((l, i) => ({
        accountCode: l.account.code,
        accountLabel: l.account.label,
        debitCents: Math.max(scaled[i], 0),
        creditCents: Math.max(-scaled[i], 0),
        description: null,
      }))
      .filter((l) => l.debitCents > 0 || l.creditCents > 0)
    const hasVat = lines.some((l) => isDeductibleVatAccount(l.accountCode) || isCollectedVatAccount(l.accountCode))
    return {
      source: 'history',
      title: `Suggestion d'après le dernier rapprochement avec ${counterparty} (${formatIsoDateFr(toIsoDateUtc(candidate.date))})`,
      fromTransactionId: candidate.id,
      vatRatePercent: hasVat ? vatRateOf(lines) : null,
      lines,
    }
  }
  return null
}

/** The suggestion for a transaction, or null when nothing applies. */
export async function suggestEntry(companyId: string, transaction: Transaction): Promise<Suggestion | null> {
  return (await fromRule(companyId, transaction)) ?? (await fromHistory(companyId, transaction))
}
