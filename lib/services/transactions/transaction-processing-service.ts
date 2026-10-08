/**
 * The rules engine run ("Appliquer les règles", MCP run_rules): every
 * unreconciled transaction of the active fiscal year (or the given ones) is
 * matched against the enabled rules; with autoApply, the rule chosen by
 * pickRule (priority, then specificity) creates its draft entry and
 * reconciles the transaction.
 *
 * Every enabled rule that matches is applied: a rule matches only when all
 * its conditions do, so its number of conditions is no reason to skip it
 * (a former 80 % confidence threshold silently required three conditions).
 * `onlyAutoCreate` limits the run to the rules marked "Créer automatiquement
 * l'écriture", for runs nobody asked for explicitly (lib/transactions/rule-matcher.ts).
 */

import { prisma } from '@/lib/prisma'
import { loadRuleMatcher } from '@/lib/transactions/rule-service'
import { ApprovedStateChangedError } from '@/lib/approved-state/guard'
import { pickRule } from '@/lib/transactions/rule-matcher'
import { applyRule } from '@/lib/transactions/rule-executor'
import { logger } from '@/lib/logger'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { startOfDay, endOfDay } from '@/lib/utils/date'

export interface TransactionProcessingOptions {
  companyId: string
  transactionIds?: string[]
  autoApply?: boolean
  /** Only the rules marked "Créer automatiquement l'écriture" (autoCreate). */
  onlyAutoCreate?: boolean
}

export interface TransactionProcessingResult {
  processed: number
  matched: number
  /** Matched by a rule the run may apply (what autoApply would apply). */
  applicable: number
  applied: number
  /** Reconciled meanwhile (another run or a user): skipped, nothing created. */
  skipped: number
  errors: Array<{ transactionId: string; error: string }>
}

/**
 * Enriches a transaction with provider data
 * Uses the same field names as the API to ensure consistency
 */
function enrichTransaction(transaction: any) {
  const providerData = transaction.providerData as Record<string, unknown> | null
  const logo = providerData?.logo as { small?: string; medium?: string } | null | undefined
  const attachmentsCount =
    (transaction as { attachments?: unknown[] }).attachments?.length ?? 0;
  return {
    ...transaction,
    logoUrl: (logo?.small as string | null | undefined) ||
             (logo?.medium as string | null | undefined) || null,
    // Columns persisted by the bank sync first, provider payload as a fallback
    counterpartyName: transaction.counterpartyName || (providerData?.clean_counterparty_name as string | null | undefined) || null,
    category: transaction.category || (providerData?.category as string | null | undefined) || null,
    cashflowCategory: transaction.cashflowCategory || ((providerData?.cashflow_category as { name?: string } | null | undefined)?.name) || null,
    cashflowSubcategory: transaction.cashflowSubcategory || ((providerData?.cashflow_subcategory as { name?: string } | null | undefined)?.name) || null,
    operationType: transaction.operationType || (providerData?.operation_type as string | null | undefined) || null,
    status: (transaction.status as string | null | undefined) ?? (providerData?.status as string | null | undefined) ?? null,
    attachmentsCount,
  }
}

/**
 * Retrieves transactions to process
 */
async function getTransactionsToProcess(companyId: string, transactionIds?: string[]) {
  if (transactionIds && transactionIds.length > 0) {
    // Process only specified transactions
    return prisma.bankTransaction.findMany({
      where: {
        id: { in: transactionIds },
        bankAccount: {
          bankConnection: {
            companyId,
          },
        },
        // Never process a reconciled transaction again: it already has its entry
        reconciled: false,
      },
      include: {
        bankAccount: {
          select: {
            name: true,
            iban: true,
          },
        },
        attachments: { select: { id: true } },
      },
    })
  } else {
    // Process only unreconciled transactions whose date is in the active fiscal year
    const activeFiscalYear = await getActiveFiscalYear(companyId)
    const dateFilter = activeFiscalYear
      ? {
          date: {
            gte: startOfDay(activeFiscalYear.startDate),
            lte: endOfDay(activeFiscalYear.endDate),
          },
        }
      : {}

    return prisma.bankTransaction.findMany({
      where: {
        bankAccount: {
          bankConnection: {
            companyId,
          },
        },
        reconciled: false,
        ...dateFilter,
      },
      include: {
        bankAccount: {
          select: {
            name: true,
            iban: true,
          },
        },
        attachments: { select: { id: true } },
      },
    })
  }
}

/**
 * Processes transactions with matching rules
 */
export async function processTransactions(
  options: TransactionProcessingOptions
): Promise<TransactionProcessingResult> {
  const { companyId, transactionIds, autoApply = false, onlyAutoCreate = false } = options

  // Rules are read once per run, not once per transaction
  const [transactions, matchRules] = await Promise.all([
    getTransactionsToProcess(companyId, transactionIds),
    loadRuleMatcher(companyId),
  ])

  const results: TransactionProcessingResult = {
    processed: 0,
    matched: 0,
    applicable: 0,
    applied: 0,
    skipped: 0,
    errors: [],
  }

  // Process each transaction
  for (const transaction of transactions) {
    results.processed++

    try {
      // Enrich transaction with provider data
      const enrichedTransaction = enrichTransaction(transaction)

      // Find matching rules
      const matchingRules = matchRules(enrichedTransaction)

      if (matchingRules.length > 0) {
        results.matched++

        const bestRule = pickRule(onlyAutoCreate ? matchingRules.filter((m) => m.autoCreate) : matchingRules)
        if (bestRule) results.applicable++
        if (autoApply && bestRule) {
          try {
            const applyResult = await applyRule(
              bestRule.ruleId,
              transaction.id,
              companyId
            )

            if (applyResult.success) {
              results.applied++
            } else if (applyResult.status === 409) {
              results.skipped++
            } else {
              results.errors.push({
                transactionId: transaction.id,
                error: applyResult.error || 'Error applying rule',
              })
            }
          } catch (error: unknown) {
            // The rules approved for an MCP run changed: the run stops (KLEDG-R3-MCP-01).
            if (error instanceof ApprovedStateChangedError) throw error
            const errorMessage = error instanceof Error ? error.message : 'Error applying rule'
            results.errors.push({
              transactionId: transaction.id,
              error: errorMessage,
            })
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof ApprovedStateChangedError) throw error
      const errorMessage = error instanceof Error ? error.message : 'Error processing transaction'
      logger.error(`Error processing transaction ${transaction.id}:`, error)
      results.errors.push({
        transactionId: transaction.id,
        error: errorMessage,
      })
    }
  }

  return results
}
