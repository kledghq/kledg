/**
 * Closes a fiscal year, in one database transaction:
 *
 * 1. locks the fiscal year row (SELECT ... FOR UPDATE): a second closing,
 *    concurrent or later, waits and then finds the year closed;
 * 2. checks the year can be closed (validate-fiscal-year-closure.service);
 * 3. books the closing entry (journal CL, last day of the year): classes 6
 *    and 7 to zero, result in 120 (bénéfice) or 129 (perte);
 * 4. gets or creates the next fiscal year and copies the chart of accounts;
 * 5. books the opening entry of the next year (journal AN, first day): the
 *    balance of every balance sheet account (classes 1 to 5);
 * 6. marks the year closed (closedAt, closedById) and writes the audit log.
 *
 * From then on the database refuses any change in the closed year (see
 * lock.ts). The statements of the closed year exclude its closing entry and
 * show its real result. Allocating the result (affectation to 106, 11, 457)
 * is a separate entry of the next year, voted by the shareholders.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { validateFiscalYearClosure } from './validate-fiscal-year-closure.service'
import {
  applyLines,
  computeClosingEntry,
  computeOpeningEntry,
  LOSS_ACCOUNT,
  OpeningEntryImbalanceError,
  PROFIT_ACCOUNT,
} from './closing-entries'
import {
  CLOSING_JOURNAL,
  OPENING_JOURNAL,
  closingReference,
  openingReference,
} from './constants'
import {
  copyChartOfAccounts,
  createValidatedEntry,
  ensureAccounts,
  ensureJournal,
  loadYearBalances,
  nextFiscalYearDates,
} from './ledger'
import { lockFiscalYearRow } from './lock'

export interface CloseFiscalYearResult {
  success: boolean
  /** True when the year was already closed (nothing done). */
  alreadyClosed?: boolean
  nextFiscalYearId?: string
  /** Result of the year in euros (positive: bénéfice). */
  result?: number
  closingEntryId?: string | null
  openingEntryId?: string | null
  errors?: string[]
  warnings?: string[]
}

class ClosingRefused extends Error {
  constructor(public errors: string[], public alreadyClosed = false) {
    super(errors.join(' '))
  }
}

export async function closeFiscalYear(
  companyId: string,
  fiscalYearId: string,
  options: { userId?: string | null } = {}
): Promise<CloseFiscalYearResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const fiscalYear = await lockFiscalYearRow(tx, fiscalYearId, companyId)
        if (!fiscalYear) throw new NotFoundError('Exercice comptable non trouvé')
        if (fiscalYear.closed) throw new ClosingRefused(['Cet exercice est déjà clôturé'], true)

        const validation = await validateFiscalYearClosure(companyId, fiscalYearId, tx)
        if (!validation.canClose) throw new ClosingRefused(validation.errors)

        // 3. Closing entry
        const balances = await loadYearBalances(tx, companyId, fiscalYearId)
        const closing = computeClosingEntry(balances)
        let closingEntryId: string | null = null
        if (closing.lines.length > 0) {
          const journal = await ensureJournal(tx, companyId, CLOSING_JOURNAL)
          const accountIds = await ensureAccounts(tx, companyId, fiscalYearId, [PROFIT_ACCOUNT, LOSS_ACCOUNT])
          const labels = new Map(balances.map((b) => [b.code, b.label ?? '']))
          const entry = await createValidatedEntry(tx, {
            companyId,
            fiscalYearId,
            journalId: journal.id,
            date: fiscalYear.endDate,
            description: `Clôture de l'exercice ${fiscalYear.year} : détermination du résultat`,
            reference: closingReference(fiscalYear.year),
            lines: closing.lines,
            lineDescription: (line) =>
              line.code === PROFIT_ACCOUNT.code || line.code === LOSS_ACCOUNT.code
                ? `Résultat de l'exercice ${fiscalYear.year}`
                : `Solde du compte ${line.code} ${labels.get(line.code) ?? ''}`.trim(),
            accountIds,
          })
          closingEntryId = entry.id
        }

        // 4. Next fiscal year and its chart of accounts
        const dates = nextFiscalYearDates(fiscalYear.endDate)
        const company = await tx.company.findUnique({
          where: { id: companyId },
          select: { closingDay: true, closingMonth: true },
        })
        const next = await tx.fiscalYear.upsert({
          where: { companyId_year: { companyId, year: fiscalYear.year + 1 } },
          update: {},
          create: {
            companyId,
            year: fiscalYear.year + 1,
            closingDay: company?.closingDay ?? dates.endDate.getUTCDate(),
            closingMonth: company?.closingMonth ?? dates.endDate.getUTCMonth() + 1,
            startDate: dates.startDate,
            endDate: dates.endDate,
          },
        })
        const lockedNext = await lockFiscalYearRow(tx, next.id)
        if (lockedNext?.closed) throw new ClosingRefused([`L'exercice suivant (${next.year}) est déjà clôturé.`])
        await copyChartOfAccounts(tx, companyId, fiscalYearId, next.id)

        // 5. Opening entry of the next year, from the balances after closing
        const opening = computeOpeningEntry(applyLines(balances, closing.lines))
        let openingEntryId: string | null = null
        if (opening.length > 0) {
          const journal = await ensureJournal(tx, companyId, OPENING_JOURNAL)
          const labels = new Map(balances.map((b) => [b.code, b.label ?? '']))
          labels.set(PROFIT_ACCOUNT.code, PROFIT_ACCOUNT.label)
          labels.set(LOSS_ACCOUNT.code, LOSS_ACCOUNT.label)
          const accountIds = await ensureAccounts(
            tx,
            companyId,
            next.id,
            opening.map((l) => ({ code: l.code, label: labels.get(l.code) ?? l.code }))
          )
          const entry = await createValidatedEntry(tx, {
            companyId,
            fiscalYearId: next.id,
            journalId: journal.id,
            date: next.startDate,
            description: `À-nouveaux de l'exercice ${next.year} (soldes de clôture ${fiscalYear.year})`,
            reference: openingReference(next.year),
            lines: opening,
            lineDescription: (line) => `À-nouveau ${line.code} ${labels.get(line.code) ?? ''}`.trim(),
            accountIds,
          })
          openingEntryId = entry.id
        }

        // 6. Lock the year and keep a trace of the closing
        const closedAt = new Date()
        await tx.fiscalYear.update({
          where: { id: fiscalYearId },
          data: { isClosed: true, closedAt, closedById: options.userId ?? null },
        })
        await tx.auditLog.create({
          data: {
            userId: options.userId ?? null,
            companyId,
            action: 'CLOSE_FISCAL_YEAR',
            level: 'INFO',
            message: `Exercice ${fiscalYear.year} clôturé`,
            metadata: {
              fiscalYearId,
              year: fiscalYear.year,
              nextFiscalYearId: next.id,
              resultCents: closing.resultCents,
              closingEntryId,
              openingEntryId,
              warnings: validation.warnings,
            },
          },
        })

        return {
          success: true,
          nextFiscalYearId: next.id,
          result: closing.resultCents / 100,
          closingEntryId,
          openingEntryId,
          warnings: validation.warnings,
        }
      },
      { maxWait: 15_000, timeout: 120_000 }
    )
  } catch (error) {
    if (error instanceof ClosingRefused) {
      return { success: false, alreadyClosed: error.alreadyClosed, errors: error.errors }
    }
    if (
      error instanceof NotFoundError ||
      error instanceof ConflictError ||
      error instanceof ValidationError ||
      error instanceof OpeningEntryImbalanceError
    ) {
      return { success: false, errors: [error.message] }
    }
    logger.error('Error closing fiscal year:', error)
    return {
      success: false,
      errors: ["Erreur interne lors de la clôture : rien n'a été modifié. Réessayez ou contactez votre administrateur."],
    }
  }
}
