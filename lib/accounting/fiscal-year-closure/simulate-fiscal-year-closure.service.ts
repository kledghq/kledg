/**
 * Preview of a fiscal year closing, without writing anything: the next
 * fiscal year, the closing entry (result to 120 / 129) and the opening
 * entry of the next year, plus the checks of validateFiscalYearClosure.
 *
 * A closing that is blocked (drafts left, year not ended...) is still
 * simulated on the entries as they are, so the user sees the result and the
 * reasons together; `success` stays false and `errors` lists the reasons.
 */

import { prisma } from '@/lib/prisma'
import { validateFiscalYearClosure } from './validate-fiscal-year-closure.service'
import {
  applyLines,
  computeClosingEntry,
  computeOpeningEntry,
  LOSS_ACCOUNT,
  OpeningEntryImbalanceError,
  PROFIT_ACCOUNT,
} from './closing-entries'
import { loadYearBalances, nextFiscalYearDates } from './ledger'

export interface ClosureSimulation {
  nextFiscalYear: { year: number; startDate: Date; endDate: Date; exists: boolean }
  accountsToCreate: number
  accountsPreview: Array<{ code: string; label: string }>
  closingEntries: {
    incomeStatement: {
      entryCount: number
      totalLines: number
      accountsToClose: number
      estimatedResult: number
    }
    result: {
      amount: number
      accountCode: string
      accountLabel: string
    }
  }
  openingEntries: {
    entryCount: number
    totalLines: number
    accountsWithBalance: number
    totalDebit: number
    totalCredit: number
    preview: Array<{ accountCode: string; accountLabel: string; balance: number; description: string }>
  }
  warnings: string[]
}

export async function simulateFiscalYearClosure(
  companyId: string,
  fiscalYearId: string
): Promise<{ success: boolean; errors?: string[]; warnings?: string[]; simulation?: ClosureSimulation }> {
  const validation = await validateFiscalYearClosure(companyId, fiscalYearId)
  const blocked = validation.canClose ? undefined : { success: false, errors: validation.errors, warnings: validation.warnings }

  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } })
  if (!fiscalYear) return blocked ?? { success: false, errors: ['Exercice comptable non trouvé'] }

  const balances = await prisma.$transaction((tx) => loadYearBalances(tx, companyId, fiscalYearId))
  const closing = computeClosingEntry(balances)
  let opening: ReturnType<typeof computeOpeningEntry>
  try {
    opening = computeOpeningEntry(applyLines(balances, closing.lines))
  } catch (error) {
    if (error instanceof OpeningEntryImbalanceError) {
      return { success: false, errors: [...(blocked?.errors ?? []), error.message], warnings: validation.warnings }
    }
    throw error
  }

  const existingNext = await prisma.fiscalYear.findFirst({
    where: { companyId, year: fiscalYear.year + 1 },
  })
  const dates = existingNext
    ? { startDate: existingNext.startDate, endDate: existingNext.endDate }
    : nextFiscalYearDates(fiscalYear.endDate)

  const [current, nextAccounts] = await Promise.all([
    prisma.account.findMany({
      where: { companyId, fiscalYearId },
      select: { code: true, label: true },
      orderBy: { code: 'asc' },
    }),
    existingNext
      ? prisma.account.findMany({ where: { companyId, fiscalYearId: existingNext.id }, select: { code: true } })
      : Promise.resolve([] as Array<{ code: string }>),
  ])
  const nextCodes = new Set(nextAccounts.map((a) => a.code))
  const toCreate = current.filter((a) => !nextCodes.has(a.code))

  const labels = new Map(balances.map((b) => [b.code, b.label ?? '']))
  labels.set(PROFIT_ACCOUNT.code, PROFIT_ACCOUNT.label)
  labels.set(LOSS_ACCOUNT.code, LOSS_ACCOUNT.label)
  const resultAccount = closing.resultCents >= 0 ? PROFIT_ACCOUNT : LOSS_ACCOUNT

  return {
    ...(blocked ?? { success: true }),
    warnings: validation.warnings,
    simulation: {
      nextFiscalYear: { year: fiscalYear.year + 1, ...dates, exists: !!existingNext },
      accountsToCreate: toCreate.length,
      accountsPreview: toCreate.slice(0, 20),
      closingEntries: {
        incomeStatement: {
          entryCount: closing.lines.length > 0 ? 1 : 0,
          totalLines: closing.lines.length,
          accountsToClose: closing.lines.filter((l) => /^[67]/.test(l.code)).length,
          estimatedResult: closing.resultCents / 100,
        },
        result: {
          amount: closing.resultCents / 100,
          accountCode: resultAccount.code,
          accountLabel: resultAccount.label,
        },
      },
      openingEntries: {
        entryCount: opening.length > 0 ? 1 : 0,
        totalLines: opening.length,
        accountsWithBalance: opening.length,
        totalDebit: opening.reduce((s, l) => s + l.debitCents, 0) / 100,
        totalCredit: opening.reduce((s, l) => s + l.creditCents, 0) / 100,
        preview: opening.slice(0, 50).map((l) => ({
          accountCode: l.code,
          accountLabel: labels.get(l.code) ?? '',
          balance: (l.debitCents - l.creditCents) / 100,
          description: `À-nouveau ${l.code}`,
        })),
      },
      warnings: validation.warnings,
    },
  }
}
