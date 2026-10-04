import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { handleError } from '@/lib/accounting/errors'
import { errorReason } from '@/lib/banking/errors'
import { plural } from '@/lib/utils/plural'
import { pickRule } from '@/lib/transactions/rule-matcher'

export interface RefreshCompanyResult {
  bankSync: { success: boolean; message: string; accountsSynced: number }
  entryDatesSync: { success: boolean; message: string; entriesUpdated: number }
  rulesExecution: {
    success: boolean
    message: string
    /** Transactions reconciled by a rule (entry created). */
    transactionsProcessed: number
    /** Rule applications that failed: nothing was created for these transactions. */
    transactionsFailed: number
    /** Reconciled meanwhile (another run or a user): skipped. */
    transactionsSkipped: number
    /** First failures, for the toast and the logs. */
    failures: Array<{ transactionId: string; error: string }>
  }
}

const MAX_REPORTED_FAILURES = 10

const ENTRY_DATES_FAILED = "les dates des écritures rapprochées n'ont pas pu être alignées. Réessayez dans quelques minutes."
const RULE_FAILED = "Impossible d'appliquer la règle : une erreur inattendue est survenue."
const RULES_FAILED = 'une erreur inattendue a interrompu les règles. Réessayez dans quelques minutes.'

/**
 * The message of a failure, safe to show: Kledg's typed errors keep their
 * French message, anything else (database, library, bug) becomes `fallback`.
 * The result reaches the client, so a raw `error.message` never does; the
 * detail is logged by handleError.
 */
function userMessage(error: unknown, fallback: string): string {
  const { message, statusCode } = handleError(error)
  return statusCode >= 500 ? fallback : message
}

/**
 * Body of POST /api/tasks/refresh: how many days of bank history to sync
 * (refreshCompany caps it at 730), the default window when absent.
 */
export const RefreshCompanyBodySchema = z
  .object({ maxDays: z.number({ error: 'Le nombre de jours doit être un nombre' }).int().positive().optional() })
  .optional()
  .default({})

/** French summary of a rules run. */
export function rulesExecutionMessage(processed: number, failed: number): string {
  const done = `${plural(processed, 'transaction traitée', 'transactions traitées')}`
  return failed > 0 ? `${done}, ${failed} en échec` : done
}

export async function refreshCompany(
  companyId: string,
  maxDaysParam?: number
): Promise<RefreshCompanyResult> {
  const maxDays =
    typeof maxDaysParam === 'number' && maxDaysParam > 0
      ? Math.min(maxDaysParam, 730)
      : 30

  const results: RefreshCompanyResult = {
    bankSync: { success: false, message: '', accountsSynced: 0 },
    entryDatesSync: { success: false, message: '', entriesUpdated: 0 },
    rulesExecution: {
      success: false,
      message: '',
      transactionsProcessed: 0,
      transactionsFailed: 0,
      transactionsSkipped: 0,
      failures: [],
    },
  }

  // Step 1: Sync bank accounts
  try {
    const encryptionKey = getEncryptionKey()
    if (!encryptionKey) {
      throw new Error('Encryption key not configured')
    }

    const integrations = await prisma.integration.findMany({
      where: {
        companyId,
        status: 'active',
        type: 'BANKING',
      },
      include: {
        resources: {
          where: { shouldSync: true, resourceType: 'bank_account' },
        },
      },
    })

    let accountsSynced = 0
    for (const integration of integrations) {
      try {
        const { syncIntegration } = await import('@/lib/integrations/sync')
        const { IntegrationFeature } = await import('@/lib/integrations/types')

        const syncResult = await syncIntegration(
          integration.id,
          encryptionKey,
          [IntegrationFeature.BANKING_ACCOUNTS, IntegrationFeature.BANKING_TRANSACTIONS],
          { maxDays }
        )

        if (syncResult.success) {
          accountsSynced += integration.resources.length
        }
      } catch (error) {
        logger.error(`Error syncing integration ${integration.id}:`, error)
      }
    }

    results.bankSync = {
      success: accountsSynced > 0,
      message: `${plural(accountsSynced, 'compte synchronisé', 'comptes synchronisés')}`,
      accountsSynced,
    }
  } catch (error) {
    logger.error(`Bank sync failed for company ${companyId}:`, error)
    results.bankSync = {
      success: false,
      message: `Erreur lors de la synchronisation : ${errorReason(error)}`,
      accountsSynced: 0,
    }
  }

  // Step 2: Align reconciled entry dates on transactions
  try {
    const { updateEntryDatesFromReconciledTransactions } = await import(
      '@/lib/services/banking/update-entry-dates-from-transactions.service'
    )
    const { entriesUpdated } = await updateEntryDatesFromReconciledTransactions({ companyId })
    results.entryDatesSync = {
      success: true,
      message:
        entriesUpdated > 0
          ? `${plural(entriesUpdated, 'écriture mise', 'écritures mises')} à jour`
          : 'Aucune écriture à mettre à jour',
      entriesUpdated,
    }
  } catch (error) {
    logger.error('Error updating entry dates from transactions:', error)
    results.entryDatesSync = {
      success: false,
      message: `Erreur lors de la mise à jour des dates d'écriture : ${userMessage(error, ENTRY_DATES_FAILED)}`,
      entriesUpdated: 0,
    }
  }

  // Step 3: apply the rules marked "Créer automatiquement l'écriture" to the
  // unreconciled transactions of the active fiscal year. The other rules stay
  // suggestions in the Rapprochement queue (lib/transactions/rule-matcher.ts).
  try {
    const { loadRuleMatcher } = await import('@/lib/transactions/rule-service')
    const { applyRule } = await import('@/lib/transactions/rule-executor')
    const { getActiveFiscalYear } = await import('@/lib/accounting/fiscal-year-utils')
    const { startOfDay, endOfDay } = await import('@/lib/utils/date')

    const activeFiscalYear = await getActiveFiscalYear(companyId)
    const dateFilter = activeFiscalYear
      ? {
          date: {
            gte: startOfDay(activeFiscalYear.startDate),
            lte: endOfDay(activeFiscalYear.endDate),
          },
        }
      : {}

    const transactions = await prisma.bankTransaction.findMany({
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
        bankAccount: { select: { name: true, iban: true } },
      },
    })

    // Rules are read once for the run, not once per transaction
    const matchRules = transactions.length > 0 ? await loadRuleMatcher(companyId) : () => []
    let processed = 0
    let failed = 0
    let skipped = 0
    const failures: Array<{ transactionId: string; error: string }> = []
    const recordFailure = (transactionId: string, error: string) => {
      failed++
      if (failures.length < MAX_REPORTED_FAILURES) failures.push({ transactionId, error })
    }
    for (const transaction of transactions) {
      try {
        const rule = pickRule(matchRules(transaction).filter((match) => match.autoCreate))
        if (rule) {
          const result = await applyRule(rule.ruleId, transaction.id, companyId)
          if (result.success) processed++
          else if (result.status === 409) skipped++
          else recordFailure(transaction.id, result.error || "Impossible d'appliquer la règle")
        }
      } catch (error) {
        logger.error(`Error processing transaction ${transaction.id}:`, error)
        recordFailure(transaction.id, userMessage(error, RULE_FAILED))
      }
    }
    if (failed > 0) {
      logger.warn(`Rules execution: ${failed} failure(s) for company ${companyId}`, { failures })
    }

    results.rulesExecution = {
      success: true,
      message: rulesExecutionMessage(processed, failed),
      transactionsProcessed: processed,
      transactionsFailed: failed,
      transactionsSkipped: skipped,
      failures,
    }
  } catch (error) {
    logger.error(`Rules execution failed for company ${companyId}:`, error)
    results.rulesExecution = {
      success: false,
      message: `Erreur lors de l'exécution des règles : ${userMessage(error, RULES_FAILED)}`,
      transactionsProcessed: 0,
      transactionsFailed: 0,
      transactionsSkipped: 0,
      failures: [],
    }
  }

  return results
}
