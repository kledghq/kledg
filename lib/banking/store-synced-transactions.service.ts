/**
 * Writes the transactions a bank API returned for one bank account.
 *
 * Invariants (a retried or concurrent sync creates nothing twice):
 * - the whole write runs in one database transaction under an advisory
 *   lock on the bank account, so two syncs of the same account queue
 *   instead of both seeing a line as new;
 * - a provider line is known once its id is stored on the account
 *   (BankTransaction, unique bankAccountId + externalTransactionId) or
 *   recorded as a match (BankTransactionMatch, same unique pair);
 * - a new line that duplicates an operation the account already holds from
 *   another source is recorded as a match instead of being inserted. Other
 *   sources are the statement files imported into this account, and every
 *   line of the other accounts of the company with the same IBAN (the Ponto
 *   account a direct Qonto or Revolut connection replaced, a manual account
 *   fed by files). The rule is the statement import's
 *   (lib/banking/probable-duplicates.ts): same amount in cents and side,
 *   same booking or value day, one to one. Lines the provider declined are
 *   never matched, and lines this provider stored itself never are either:
 *   two identical card payments on one day stay two operations;
 * - lines already stored whose status or date changed (Qonto pending to
 *   completed) are updated.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ProviderTransaction } from '@/lib/banking/providers/types'
import { IMPORT_ID_PREFIX } from '@/lib/banking/import/dedupe'
import { dayWindow, matchProbableDuplicates, signedCents, type ExistingLine } from '@/lib/banking/probable-duplicates'
import { newTransactions, normalizeIban } from '@/lib/banking/sync-rules'
import { centsToDecimal, toCents } from '@/lib/utils/money'
import { addIsoDays, calendarDayOf, isoDateToUtc, toIsoDateUtc } from '@/lib/utils/date'

type Tx = Prisma.TransactionClient

export interface SyncTarget {
  id: string
  companyId: string
  bankConnectionId: string
  iban: string | null
}

export interface StoreOutcome {
  /** Lines inserted. */
  created: number
  /** Lines recorded as duplicates of a transaction from another source. */
  matched: number
  /** Stored lines whose status or date was updated. */
  updated: number
}

/** Value dates sit a few days from booking dates: existing lines are loaded this far around the new ones. */
const WINDOW_DAYS = 31
const BATCH_SIZE = 500

const isFileImport = (externalTransactionId: string, providerData: Prisma.JsonValue): boolean =>
  externalTransactionId.startsWith(IMPORT_ID_PREFIX) ||
  externalTransactionId.startsWith('import-') ||
  (!!providerData && typeof providerData === 'object' && !Array.isArray(providerData) && providerData.source === 'file-import')

function valueDayOf(providerData: Prisma.JsonValue): string | null {
  if (!providerData || typeof providerData !== 'object' || Array.isArray(providerData)) return null
  const value = providerData.valueDate
  return typeof value === 'string' ? calendarDayOf(value) : null
}

/** Absolute provider amount to cents (bank feeds send decimals). */
const centsOf = (amount: number) => Math.abs(toCents(amount) ?? 0)

function transactionRow(bankAccountId: string, tx: ProviderTransaction): Prisma.BankTransactionCreateManyInput {
  return {
    bankAccountId,
    externalTransactionId: tx.externalId,
    amount: centsToDecimal(toCents(tx.amount) ?? 0),
    date: tx.date,
    label: tx.label || null,
    reference: tx.reference || null,
    side: tx.side,
    note: tx.note || null,
    logoUrl: tx.logoUrl || null,
    counterpartyName: tx.counterpartyName || null,
    category: tx.category || null,
    cashflowCategory: tx.cashflowCategory || null,
    cashflowSubcategory: tx.cashflowSubcategory || null,
    operationType: tx.operationType || null,
    vatRate: tx.vatRate ?? null,
    vatAmount: tx.vatAmount ?? null,
    status: tx.status ?? null,
    providerData: (tx.providerData || undefined) as Prisma.InputJsonValue | undefined,
    imported: true,
  }
}

/**
 * Existing lines a new line may duplicate (see the module header), oldest
 * first, without those already standing for a provider line.
 */
async function otherSourceLines(db: Tx, account: SyncTarget, window: { first: string; last: string }): Promise<ExistingLine[]> {
  const iban = normalizeIban(account.iban)
  // IBANs are stored with or without spaces: compared once normalized
  const others = iban
    ? (
        await db.bankAccount.findMany({
          where: {
            id: { not: account.id },
            bankConnectionId: { not: account.bankConnectionId },
            bankConnection: { companyId: account.companyId },
            iban: { not: null },
          },
          select: { id: true, iban: true },
        })
      )
        .filter((a) => normalizeIban(a.iban) === iban)
        .map((a) => a.id)
    : []
  const rows = await db.bankTransaction.findMany({
    where: {
      date: { gte: isoDateToUtc(addIsoDays(window.first, -WINDOW_DAYS)), lte: isoDateToUtc(addIsoDays(window.last, WINDOW_DAYS)) },
      syncMatch: null,
      bankAccountId: { in: [account.id, ...others] },
    },
    select: { id: true, bankAccountId: true, externalTransactionId: true, date: true, amount: true, side: true, providerData: true },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })
  return rows
    .filter((row) => row.bankAccountId !== account.id || isFileImport(row.externalTransactionId, row.providerData))
    .map((row) => ({
      id: row.id,
      amountCents: signedCents(Math.abs(toCents(row.amount) ?? 0), row.side),
      day: toIsoDateUtc(row.date),
      valueDay: valueDayOf(row.providerData),
    }))
}

export async function storeSyncedTransactions(account: SyncTarget, incoming: ProviderTransaction[]): Promise<StoreOutcome> {
  return prisma.$transaction(
    async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:bank-sync:${account.id}`}))`
      const ids = incoming.map((t) => t.externalId)
      const [stored, recorded] = await Promise.all([
        db.bankTransaction.findMany({
          where: { bankAccountId: account.id, externalTransactionId: { in: ids } },
          select: { externalTransactionId: true, status: true, date: true },
        }),
        db.bankTransactionMatch.findMany({
          where: { bankAccountId: account.id, externalTransactionId: { in: ids } },
          select: { externalTransactionId: true },
        }),
      ])
      const fresh = newTransactions(incoming, [...stored, ...recorded].map((t) => t.externalTransactionId))

      // Probable duplicates of another source: declined lines never are one
      const candidates = fresh.filter((t) => t.state !== 'rejected')
      const lines = candidates.map((t) => ({
        amountCents: signedCents(centsOf(t.amount), t.side),
        day: toIsoDateUtc(t.date),
        valueDay: t.valueDate ?? null,
      }))
      const window = dayWindow(lines)
      const matches = window ? matchProbableDuplicates(lines, await otherSourceLines(db, account, window)) : new Map<number, ExistingLine>()
      const matchedIds = new Set([...matches.keys()].map((index) => candidates[index].externalId))

      if (matches.size > 0) {
        await db.bankTransactionMatch.createMany({
          data: [...matches].map(([index, line]) => ({
            bankAccountId: account.id,
            externalTransactionId: candidates[index].externalId,
            bankTransactionId: line.id,
          })),
          skipDuplicates: true,
        })
      }

      const toCreate = fresh.filter((t) => !matchedIds.has(t.externalId))
      let created = 0
      for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
        const batch = toCreate.slice(i, i + BATCH_SIZE)
        created += (await db.bankTransaction.createMany({ data: batch.map((t) => transactionRow(account.id, t)), skipDuplicates: true })).count
      }

      // Lines already stored whose status or date changed (Qonto pending to completed)
      const byId = new Map(stored.map((t) => [t.externalTransactionId, t]))
      let updated = 0
      for (const tx of incoming) {
        const row = byId.get(tx.externalId)
        if (!row) continue
        if (row.status === (tx.status ?? null) && row.date.getTime() === tx.date.getTime()) continue
        await db.bankTransaction.updateMany({
          where: { bankAccountId: account.id, externalTransactionId: tx.externalId },
          data: { date: tx.date, status: tx.status ?? null, providerData: (tx.providerData || undefined) as Prisma.InputJsonValue | undefined },
        })
        updated++
      }
      return { created, matched: matches.size, updated }
    },
    { timeout: 60_000, maxWait: 15_000 },
  )
}
