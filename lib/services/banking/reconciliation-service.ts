/**
 * Banking reconciliation service layer
 * 
 * Handles business logic for bank reconciliation operations
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { bankLineCents, reconciliationWindow, transactionMatchesBankLine } from '@/lib/reconciliation/bank-line-match'
import type { EntryLine } from '@/lib/accounting/types'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { plural } from '@/lib/utils/plural'

export interface ReconciliationResult {
  matched: boolean
  transactionId?: string
}

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

/**
 * Attempts to automatically reconcile bank entries with bank transactions
 */
export async function attemptBankReconciliation(
  companyId: string,
  entryId: string,
  entryLines: EntryLine[],
  entryDate: Date
): Promise<ReconciliationResult> {
  try {
    // Find all bank lines in the entry (account class 51)
    const bankLines: Array<{ line: EntryLine; account: { id: string; code: string } }> = []
    
    for (const line of entryLines) {
      // Only accounts of the company count as bank lines
      const account = await prisma.account.findFirst({
        where: { id: line.accountId, companyId },
        select: { id: true, code: true },
      })
      
      if (account && account.code.startsWith('51')) {
        bankLines.push({ line, account })
      }
    }

    if (bankLines.length === 0) {
      return { matched: false }
    }

    // Search for unreconciled bank transactions that match
    const bankAccounts = await prisma.bankAccount.findMany({
      where: {
        bankConnection: {
          companyId,
        },
      },
      select: { id: true },
    })

    // For each bank line, search for a matching transaction
    for (const { line: bankLine } of bankLines) {
      // Calculate the bank entry amount (debit - credit)
      const lineCents = bankLineCents(bankLine)

      // For each bank account, search for matching transactions
      for (const bankAccount of bankAccounts) {
        // Search for unreconciled transactions within a ±1 day window

        const matchingTransactions = await prisma.bankTransaction.findMany({
          where: {
            bankAccountId: bankAccount.id,
            reconciled: false,
            date: reconciliationWindow(entryDate),
          },
        })

        // Same amount to the cent, opposite side (a debit on the bank account is a credit transaction)
        const exactMatches = matchingTransactions.filter((transaction) => transactionMatchesBankLine(lineCents, transaction))
        
        // One entry reconciles one transaction: link the first match still
        // unreconciled (conditional update, safe against a concurrent run).
        for (const transaction of exactMatches) {
          const claimed = await prisma.bankTransaction.updateMany({
            where: { id: transaction.id, reconciled: false },
            data: {
              reconciled: true,
              reconciledAt: new Date(),
              reconciledWith: entryId,
            },
          })
          if (claimed.count > 0) return { matched: true, transactionId: transaction.id }
        }
      }
    }
    
    return { matched: false }
  } catch {
    // Don't block import if reconciliation fails
    return { matched: false }
  }
}

/**
 * Unreconciles bank transactions that are marked as reconciled but whose
 * linked accounting entry (reconciledWith) no longer exists.
 * @returns Number of transactions unreconciled
 */
async function unreconcileOrphanedTransactions(companyId: string): Promise<number> {
  const reconciledTxns = await prisma.bankTransaction.findMany({
    where: {
      bankAccount: { bankConnection: { companyId } },
      reconciled: true,
      reconciledWith: { not: null },
    },
    select: { id: true, reconciledWith: true },
  })

  const entryIds = [
    ...new Set(reconciledTxns.map((t) => t.reconciledWith).filter(Boolean)),
  ] as string[]
  if (entryIds.length === 0) return 0

  const existingEntries = await prisma.accountingEntry.findMany({
    where: { id: { in: entryIds }, companyId },
    select: { id: true },
  })
  const existingIds = new Set(existingEntries.map((e) => e.id))

  const toUnreconcile = reconciledTxns.filter(
    (t) => t.reconciledWith != null && !existingIds.has(t.reconciledWith)
  )
  if (toUnreconcile.length === 0) return 0

  await prisma.bankTransaction.updateMany({
    where: { id: { in: toUnreconcile.map((t) => t.id) } },
    data: {
      reconciled: false,
      reconciledAt: null,
      reconciledWith: null,
    },
  })
  return toUnreconcile.length
}

/**
 * Automatically reconciles bank entries with bank transactions
 */
export async function autoReconcile(options: AutoReconciliationOptions): Promise<AutoReconciliationResult> {
  const { companyId, startDate, endDate } = options

  const unreconciledOrphanedCount = await unreconcileOrphanedTransactions(companyId)

  // Retrieve all entries from the BQ (Bank) journal that are not reconciled
  const journalBQ = await prisma.journal.findFirst({
    where: {
      companyId,
      code: 'BQ',
    },
  })

  if (!journalBQ) {
    return {
      success: true,
      matched: 0,
      reconciledCount: 0,
      total: 0,
      unreconciledOrphanedCount,
      message:
        unreconciledOrphanedCount > 0
          ? `${plural(unreconciledOrphanedCount, 'transaction dé-rapprochée', 'transactions dé-rapprochées')} (écriture supprimée). Aucun journal BQ.`
          : 'No BQ journal found',
    }
  }

  // Build date filters
  const whereClause: Prisma.AccountingEntryWhereInput = {
    companyId,
    journalId: journalBQ.id,
    ...(startDate && endDate
      ? {
          date: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        }
      : {}),
  }

  // Retrieve entries with their lines, filtering for entries with bank accounts (51*)
  const entries = await prisma.accountingEntry.findMany({
    where: whereClause,
    include: {
      lines: {
        include: {
          account: true,
        },
      },
    },
    orderBy: {
      date: 'asc',
    },
  })

  // Entries already linked to a transaction are done: never link them twice
  const linked = await prisma.bankTransaction.findMany({
    where: { bankAccount: { bankConnection: { companyId } }, reconciledWith: { not: null } },
    select: { reconciledWith: true },
  })
  const linkedEntryIds = new Set(linked.map((t) => t.reconciledWith))

  // Filter entries that have at least one bank account line (51*)
  const entriesWithBankLines = entries.filter(
    (entry) =>
      !linkedEntryIds.has(entry.id) && entry.lines.some((line) => line.account.code.startsWith('51'))
  )

  let matchedCount = 0
  let errorCount = 0

  // For each entry, attempt reconciliation
  for (const entry of entriesWithBankLines) {
    try {
      // Convert lines to EntryLine format
      const entryLines: EntryLine[] = entry.lines.map((line) => ({
        accountId: line.accountId,
        debit: Number(line.debit),
        credit: Number(line.credit),
        description: line.description || '',
      }))

      const result = await attemptBankReconciliation(
        companyId,
        entry.id,
        entryLines,
        entry.date
      )

      if (result.matched) {
        matchedCount++
      }
    } catch (error) {
      errorCount++
      // Continue processing other entries even if one fails
      logger.error(`Error reconciling entry ${entry.id}:`, { error, entryId: entry.id })
    }
  }

  const parts: string[] = []
  if (unreconciledOrphanedCount > 0) {
    parts.push(
      `${plural(unreconciledOrphanedCount, 'transaction dé-rapprochée', 'transactions dé-rapprochées')} (écriture supprimée)`
    )
  }
  if (errorCount > 0) {
    parts.push(
      `${plural(matchedCount, 'transaction rapprochée', 'transactions rapprochées')} sur ${plural(entriesWithBankLines.length, 'écriture analysée', 'écritures analysées')} (${plural(errorCount, 'erreur')})`
    )
  } else {
    parts.push(
      `${plural(matchedCount, 'transaction rapprochée', 'transactions rapprochées')} sur ${plural(entriesWithBankLines.length, 'écriture analysée', 'écritures analysées')}`
    )
  }

  return {
    success: true,
    matched: matchedCount,
    reconciledCount: matchedCount,
    total: entriesWithBankLines.length,
    unreconciledOrphanedCount,
    message: parts.join('. '),
  }
}
