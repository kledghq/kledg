/**
 * What the reconciliation screens read (GET /api/banking/reconciliation):
 * the company's bank accounts, their transactions and the entries booked on
 * the bank ledger accounts (PCG art. 512) of the active fiscal year.
 *
 * The ledger accounts are resolved like everywhere else
 * (lib/banking/ledger-account.ts): the selected bank account's 512 mapping
 * (else the company default), or every bank ledger account in use. Amounts
 * are summed in cents.
 */

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { bankLedgerAccountsInUse, resolveBankAccountLedger, type LedgerAccountRef } from '@/lib/banking/ledger-account'
import { fromCents, toCents } from '@/lib/utils/money'
import { calendarDayOf, endOfDay, isoDateToUtc } from '@/lib/utils/date'

const PERIOD_MESSAGE = 'Période invalide : utilisez des dates au format aaaa-mm-jj.'

/** Query of GET /api/banking/reconciliation (companyId is read by the route's resolver). */
export const ReconciliationQuerySchema = z.object({
  bankAccountId: z.string().max(200).optional(),
  /** Former name of bankAccountId. */
  qontoAccountId: z.string().max(200).optional(),
  startDate: z.string().max(40).optional(),
  endDate: z.string().max(40).optional(),
  /**
   * The reconciliation page reads the transactions from /api/transactions:
   * includeTransactions=false skips them here (they are every transaction of
   * the company when no dates are given). Default true, for compatibility.
   */
  includeTransactions: z.string().optional(),
})

export type ReconciliationQuery = z.infer<typeof ReconciliationQuerySchema>

/** Query of DELETE /api/banking/reconciliation. */
export const UnreconcileQuerySchema = z.object({
  transactionId: z.string({ error: 'Précisez la transaction (transactionId).' }).min(1).max(200),
})

/**
 * Optional period filter: both days given (yyyy-mm-dd, or an ISO timestamp
 * read as its calendar day), from the start of the first to the end of the
 * last, in UTC like every stored accounting date.
 */
function periodOf(start: string | undefined, end: string | undefined): { gte: Date; lte: Date } | null {
  if (!start || !end) return null
  const from = calendarDayOf(start)
  const to = calendarDayOf(end)
  if (!from || !to) throw new ValidationError(PERIOD_MESSAGE)
  return { gte: isoDateToUtc(from), lte: endOfDay(isoDateToUtc(to)) }
}

interface ReconciliationEntry {
  id: string
  date: Date
  description: string | null
  entryNumber: string
  status: string
  journal: { code: string; label: string }
  lines: Array<{ id: string; debit: number; credit: number; description: string | null }>
  totalDebit: number
  totalCredit: number
}

/** Entries with a line on the given ledger accounts, grouped by entry, totals summed in cents. */
async function entriesOnLedgerAccounts(
  ledgerAccounts: LedgerAccountRef[],
  period: { gte: Date; lte: Date } | null,
): Promise<ReconciliationEntry[]> {
  if (ledgerAccounts.length === 0) return []
  const lines = await prisma.entryLine.findMany({
    where: {
      accountId: { in: ledgerAccounts.map((a) => a.id) },
      ...(period ? { accountingEntry: { date: period } } : {}),
    },
    select: {
      id: true,
      debit: true,
      credit: true,
      description: true,
      accountingEntry: {
        select: { id: true, date: true, description: true, entryNumber: true, status: true, journal: { select: { code: true, label: true } } },
      },
    },
    orderBy: { accountingEntry: { date: 'asc' } },
  })
  const grouped = new Map<string, ReconciliationEntry & { debitCents: number; creditCents: number }>()
  for (const line of lines) {
    const entry = line.accountingEntry
    const mapped = grouped.get(entry.id) ?? { ...entry, lines: [], totalDebit: 0, totalCredit: 0, debitCents: 0, creditCents: 0 }
    grouped.set(entry.id, mapped)
    const debitCents = toCents(line.debit) ?? 0
    const creditCents = toCents(line.credit) ?? 0
    mapped.lines.push({ id: line.id, debit: fromCents(debitCents), credit: fromCents(creditCents), description: line.description })
    mapped.debitCents += debitCents
    mapped.creditCents += creditCents
  }
  return [...grouped.values()].map(({ debitCents, creditCents, ...entry }) => ({
    ...entry,
    totalDebit: fromCents(debitCents),
    totalCredit: fromCents(creditCents),
  }))
}

export async function getReconciliationOverview(companyId: string, query: ReconciliationQuery) {
  const bankAccountId = query.bankAccountId || query.qontoAccountId || null
  const period = periodOf(query.startDate, query.endDate)
  const includeTransactions = query.includeTransactions !== 'false'

  // Explicit select: never load the connection credentials
  const bankAccounts = await prisma.bankAccount.findMany({
    where: { bankConnection: { companyId } },
    select: {
      id: true,
      name: true,
      displayName: true,
      iban: true,
      balance: true,
      currency: true,
      shouldSync: true,
      bankConnection: { select: { id: true } },
      integrationResource: { select: { integration: { select: { id: true, name: true, provider: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const where: Prisma.BankTransactionWhereInput = { bankAccount: { bankConnection: { companyId } } }
  if (bankAccountId) where.bankAccountId = bankAccountId
  if (period) where.date = period

  const transactions = includeTransactions
    ? await prisma.bankTransaction.findMany({
        where,
        select: {
          id: true,
          amount: true,
          date: true,
          label: true,
          reference: true,
          reconciled: true,
          reconciledAt: true,
          reconciledWith: true,
          side: true,
          vatRate: true,
          vatAmount: true,
          providerData: true,
          bankAccount: { select: { id: true, name: true, displayName: true, iban: true } },
        },
        orderBy: { date: 'desc' },
      })
    : []

  // A read never creates a fiscal year: without an open year there is no ledger account to show
  const activeFiscalYear = await getActiveFiscalYear(companyId)
  const ledgerAccounts = !activeFiscalYear
    ? []
    : bankAccountId
      ? [await resolveBankAccountLedger(companyId, activeFiscalYear.id, bankAccountId)].filter((a): a is LedgerAccountRef => a !== null)
      : await bankLedgerAccountsInUse(companyId, activeFiscalYear.id)

  return {
    bankAccounts: bankAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      displayName: account.displayName,
      iban: account.iban,
      balance: fromCents(toCents(account.balance) ?? 0),
      currency: account.currency,
      shouldSync: account.shouldSync,
      bankConnection: {
        id: account.bankConnection.id,
        provider: account.integrationResource?.integration.provider || 'UNKNOWN',
      },
    })),
    transactions: transactions.map((tx) => {
      const providerData = tx.providerData as { vat_rate?: number; vat_amount?: number; vat_amount_cents?: number } | null
      const vatRate = tx.vatRate != null ? Number(tx.vatRate) : (providerData?.vat_rate ?? null)
      const vatAmountCents =
        tx.vatAmount != null
          ? toCents(tx.vatAmount)
          : providerData?.vat_amount != null
            ? toCents(providerData.vat_amount)
            : (providerData?.vat_amount_cents ?? null)
      return {
        id: tx.id,
        amount: fromCents(toCents(tx.amount) ?? 0),
        date: tx.date.toISOString(),
        label: tx.label,
        reference: tx.reference,
        reconciled: tx.reconciled,
        reconciledAt: tx.reconciledAt?.toISOString() || null,
        reconciledWith: tx.reconciledWith,
        bankAccount: { id: tx.bankAccount.id, name: tx.bankAccount.name, displayName: tx.bankAccount.displayName, iban: tx.bankAccount.iban },
        side: tx.side,
        vatRate: vatRate ?? undefined,
        vatAmount: vatAmountCents != null ? fromCents(vatAmountCents) : undefined,
      }
    }),
    accountingEntries: await entriesOnLedgerAccounts(ledgerAccounts, period),
    /** The bank ledger account of the selection (first in use when no bank account is selected). */
    bankAccount: ledgerAccounts[0] ?? null,
    ledgerAccounts,
  }
}
