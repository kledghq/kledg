/**
 * Automatic bank reconciliation: links bank journal entries with the bank
 * transactions they record, for the "Rapprocher automatiquement" action and
 * after a FEC import. One matcher for both (`reconcileBankEntries`):
 *
 * - bounded: entries are processed by chunks, and the candidate
 *   transactions of a chunk are loaded once, with one query, over the dates
 *   of its entries (plus or minus one day);
 * - matched in memory (`matchBankEntries`, lib/reconciliation/bank-line-match.ts):
 *   one transaction per entry and one entry per transaction, same amount to
 *   the cent, opposite side, within one calendar day, and only on the bank
 *   account mapped to the line's 512 account when it has a mapping;
 * - claimed in one statement per chunk, only while the transaction is still
 *   unreconciled, so a concurrent reconciliation is never overwritten;
 * - errors are counted and logged per chunk and reported in the result,
 *   never turned into "nothing matched".
 */

import { prisma } from '@/lib/prisma'
import { journalByCode } from '@/lib/accounting/journal-by-code'
import { logger } from '@/lib/logger'
import { addUtcDays, startOfDay } from '@/lib/utils/date'
import { matchBankEntries, type BankEntryToMatch } from '@/lib/reconciliation/bank-line-match'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { plural } from '@/lib/utils/plural'

const periodBound = z
  .string({ error: 'Date invalide' })
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Date invalide')
  .optional()

/**
 * Body of POST /api/banking/reconciliation/auto-reconcile: an optional
 * period, as sent by the reconciliation page (start of the first day, end
 * of the last day). Both bounds or none: a single bound is ignored.
 */
export const AutoReconcileBodySchema = z
  .object({ startDate: periodBound, endDate: periodBound })
  .optional()
  .default({})

export interface AutoReconciliationOptions {
  companyId: string
  startDate?: string
  endDate?: string
}

export interface AutoReconciliationResult {
  success: boolean
  matched: number
  reconciledCount: number
  total: number
  unreconciledOrphanedCount: number
  message: string
}

/** Entries matched per chunk (and claimed per statement). */
const CHUNK = 500
/** Entries one run of "Rapprocher automatiquement" analyses at most, oldest first. */
export const MAX_AUTO_RECONCILE_ENTRIES = 5_000

export interface ReconcileBankEntriesResult {
  /** Transactions linked to an entry by this run. */
  matched: number
  /** Entries whose chunk failed (logged), 0 when everything ran. */
  failed: number
}

/**
 * The unreconciled transactions of the company dated within the entries'
 * days, plus or minus one day; `released` adds transactions the run releases
 * first (the dry run, which releases nothing).
 */
async function candidateTransactions(companyId: string, entries: readonly BankEntryToMatch[], released: readonly string[] = []) {
  const times = entries.map((e) => startOfDay(e.date).getTime())
  const first = addUtcDays(new Date(Math.min(...times)), -1)
  const afterLast = addUtcDays(new Date(Math.max(...times)), 2)
  const open = released.length > 0 ? { OR: [{ reconciled: false }, { id: { in: [...released] } }] } : { reconciled: false }
  const rows = await prisma.bankTransaction.findMany({
    where: { bankAccount: { bankConnection: { companyId } }, ...open, date: { gte: first, lt: afterLast } },
    select: { id: true, date: true, amount: true, side: true, bankAccount: { select: { ledgerAccountCode: true } } },
  })
  return rows.map((t) => ({ id: t.id, date: t.date, amount: t.amount, side: t.side, ledgerAccountCode: t.bankAccount.ledgerAccountCode }))
}

/** Links each pair while its transaction is still unreconciled; returns how many were linked. */
async function claim(pairs: ReadonlyArray<{ entryId: string; transactionId: string }>): Promise<number> {
  if (pairs.length === 0) return 0
  return prisma.$executeRaw`
    UPDATE "bank_transactions" AS t
    SET "reconciled" = true, "reconciledAt" = now(), "reconciledWith" = p.entry_id, "updatedAt" = now()
    FROM unnest(${pairs.map((p) => p.transactionId)}::text[], ${pairs.map((p) => p.entryId)}::text[]) AS p(transaction_id, entry_id)
    WHERE t."id" = p.transaction_id AND t."reconciled" = false`
}

/**
 * Links bank entries of the company to its unreconciled transactions (see
 * the module header). Entry lines carry their account code: the caller
 * loaded them scoped by company. Entries already linked must be left out
 * by the caller.
 */
export async function reconcileBankEntries(companyId: string, entries: readonly BankEntryToMatch[]): Promise<ReconcileBankEntriesResult> {
  const ordered = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime())
  let matched = 0
  let failed = 0
  for (let i = 0; i < ordered.length; i += CHUNK) {
    const chunk = ordered.slice(i, i + CHUNK)
    try {
      matched += await claim(matchBankEntries(chunk, await candidateTransactions(companyId, chunk)))
    } catch (error) {
      failed += chunk.length
      logger.error('[reconciliation] Automatic reconciliation of a chunk failed', { companyId, entries: chunk.length, error })
    }
  }
  return { matched, failed }
}

/**
 * Releases transactions marked reconciled whose entry (reconciledWith) no
 * longer exists, in one statement.
 * @returns Number of transactions released
 */
async function unreconcileOrphanedTransactions(companyId: string): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "bank_transactions" AS t
    SET "reconciled" = false, "reconciledAt" = NULL, "reconciledWith" = NULL, "updatedAt" = now()
    FROM "bank_accounts" a, "bank_connections" c
    WHERE a."id" = t."bankAccountId" AND c."id" = a."bankConnectionId" AND c."companyId" = ${companyId}
      AND t."reconciled" = true AND t."reconciledWith" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "accounting_entries" e WHERE e."id" = t."reconciledWith" AND e."companyId" = ${companyId})`
}

/** Transactions marked reconciled whose entry no longer exists (what unreconcileOrphanedTransactions releases). */
async function orphanedTransactionIds(companyId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT t."id" FROM "bank_transactions" t
    JOIN "bank_accounts" a ON a."id" = t."bankAccountId"
    JOIN "bank_connections" c ON c."id" = a."bankConnectionId"
    WHERE c."companyId" = ${companyId} AND t."reconciled" = true AND t."reconciledWith" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "accounting_entries" e WHERE e."id" = t."reconciledWith" AND e."companyId" = ${companyId})`
  return rows.map((r) => r.id)
}

/** The entries of the BQ journal a run analyses, oldest first, without those already linked; null without a BQ journal. */
async function entriesToMatch(companyId: string, startDate: string | undefined, endDate: string | undefined) {
  const journalBQ = await journalByCode(prisma, companyId, 'BQ')
  if (!journalBQ) return null
  const whereClause: Prisma.AccountingEntryWhereInput = {
    companyId,
    journalId: journalBQ.id,
    lines: { some: { account: { code: { startsWith: '51' } } } },
    ...(startDate && endDate
      ? { date: { gte: new Date(startDate), lte: new Date(endDate) } }
      : { fiscalYear: { isClosed: false } }),
  }

  const entries = await prisma.accountingEntry.findMany({
    where: whereClause,
    select: { id: true, date: true, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: MAX_AUTO_RECONCILE_ENTRIES + 1,
  })
  const truncated = entries.length > MAX_AUTO_RECONCILE_ENTRIES
  const batch = entries.slice(0, MAX_AUTO_RECONCILE_ENTRIES)

  // Entries already linked to a transaction are done: never link them twice
  const linked = new Set(
    (
      await prisma.bankTransaction.findMany({
        where: { bankAccount: { bankConnection: { companyId } }, reconciledWith: { in: batch.map((e) => e.id) } },
        select: { reconciledWith: true },
      })
    ).map((t) => t.reconciledWith),
  )
  const toMatch = batch
    .filter((entry) => !linked.has(entry.id))
    .map((entry) => ({ id: entry.id, date: entry.date, lines: entry.lines.map((l) => ({ accountCode: l.account.code, debit: l.debit, credit: l.credit })) }))
  return { toMatch, truncated }
}

export interface AutoReconciliationPreview {
  /** Transactions marked reconciled whose entry was deleted: released first. */
  releasedTransactionIds: string[]
  /** Entries analysed (BQ journal, the period or the open fiscal years, not linked yet). */
  analysed: number
  /** Only the oldest MAX_AUTO_RECONCILE_ENTRIES entries are analysed. */
  truncated: boolean
  /** The pairs the run would link, oldest entry first. */
  pairs: Array<{ entryId: string; transactionId: string }>
  hasBankJournal: boolean
}

/**
 * The dry run of autoReconcile: the same entries, the same matcher, chunk
 * by chunk as the run claims them (a transaction taken by a chunk is not a
 * candidate of the next), nothing written.
 */
export async function previewAutoReconcile(options: AutoReconciliationOptions): Promise<AutoReconciliationPreview> {
  const { companyId, startDate, endDate } = options
  const releasedTransactionIds = await orphanedTransactionIds(companyId)
  const selection = await entriesToMatch(companyId, startDate, endDate)
  if (!selection) return { releasedTransactionIds, analysed: 0, truncated: false, pairs: [], hasBankJournal: false }
  const ordered = [...selection.toMatch].sort((a, b) => a.date.getTime() - b.date.getTime())
  const taken = new Set<string>()
  const pairs: Array<{ entryId: string; transactionId: string }> = []
  for (let i = 0; i < ordered.length; i += CHUNK) {
    const chunk = ordered.slice(i, i + CHUNK)
    const candidates = (await candidateTransactions(companyId, chunk, releasedTransactionIds)).filter((t) => !taken.has(t.id))
    for (const pair of matchBankEntries(chunk, candidates)) {
      taken.add(pair.transactionId)
      pairs.push(pair)
    }
  }
  return { releasedTransactionIds, analysed: ordered.length, truncated: selection.truncated, pairs, hasBankJournal: true }
}

/**
 * Automatically reconciles bank entries with bank transactions: entries of
 * the BQ journal in the period (both bounds), else in the open fiscal
 * years, not yet linked, at most MAX_AUTO_RECONCILE_ENTRIES per run.
 */
export async function autoReconcile(options: AutoReconciliationOptions): Promise<AutoReconciliationResult> {
  const { companyId, startDate, endDate } = options

  const unreconciledOrphanedCount = await unreconcileOrphanedTransactions(companyId)

  const selection = await entriesToMatch(companyId, startDate, endDate)

  if (!selection) {
    return {
      success: true,
      matched: 0,
      reconciledCount: 0,
      total: 0,
      unreconciledOrphanedCount,
      message:
        unreconciledOrphanedCount > 0
          ? `${plural(unreconciledOrphanedCount, 'transaction dé-rapprochée', 'transactions dé-rapprochées')} (écriture supprimée). Aucun journal BQ.`
          : 'Aucun journal BQ : aucune écriture bancaire à rapprocher.',
    }
  }

  const { toMatch, truncated } = selection
  const { matched, failed } = await reconcileBankEntries(companyId, toMatch)

  const parts: string[] = []
  if (unreconciledOrphanedCount > 0) {
    parts.push(
      `${plural(unreconciledOrphanedCount, 'transaction dé-rapprochée', 'transactions dé-rapprochées')} (écriture supprimée)`
    )
  }
  const summary = `${plural(matched, 'transaction rapprochée', 'transactions rapprochées')} sur ${plural(toMatch.length, 'écriture analysée', 'écritures analysées')}`
  parts.push(failed > 0 ? `${summary} (${plural(failed, 'écriture non traitée', 'écritures non traitées')} après une erreur, réessayez)` : summary)
  if (truncated) parts.push('Seules les écritures les plus anciennes ont été analysées : relancez pour la suite')

  return {
    success: failed === 0,
    matched,
    reconciledCount: matched,
    total: toMatch.length,
    unreconciledOrphanedCount,
    message: parts.join('. '),
  }
}
