/**
 * Depreciation entries of a fiscal year ("Générer les dotations").
 *
 * For each depreciable fixed asset, the allowance of the year is booked as
 * one validated entry in the OD journal on the last day of the year:
 * debit the expense account (6811x, dotations aux amortissements), credit
 * the depreciation account (28xx) (PCG chart of accounts, comptes 6811 and
 * 28). PCG art. 214-13: depreciation runs from the in-service date; the
 * amount is the linear plan's allowance for the year, prorata temporis
 * (lib/fixed-assets/depreciation-plan.ts, BOFiP BOI-BIC-AMT-20-20-20-10).
 *
 * The fixed_asset_depreciations record of the year links the asset to its
 * entry: an asset whose record already has an entry is skipped, a record
 * without entry (an amount entered by hand) is booked as entered. Running
 * it twice, or twice at the same time, books each allowance once (the
 * fiscal year row is locked for the duration of the transaction).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildDepreciationPlan, sumPlanCentsForPeriod } from './depreciation-plan'
import { ClosedFiscalYearError, NotFoundError } from '@/lib/accounting/errors'
import {
  createValidatedEntry,
  ensureAccounts,
  ensureJournal,
} from '@/lib/accounting/fiscal-year-closure/ledger'
import { lockFiscalYearRow } from '@/lib/accounting/fiscal-year-closure/lock'
import { parseCents } from '@/lib/utils/money'

type Client = Prisma.TransactionClient | typeof prisma

const OD_JOURNAL = { code: 'OD', label: 'Opérations diverses' }

export interface DepreciationToPost {
  fixedAssetId: string
  label: string
  /** Existing record of the year without entry, or null when the record is to be created. */
  recordId: string | null
  amountCents: number
  expenseAccount: { code: string; label: string }
  depreciationAccount: { code: string; label: string }
}

/** Allowances of the fiscal year that have no accounting entry yet. */
export async function findUnpostedDepreciation(
  companyId: string,
  fiscalYearId: string,
  client: Client = prisma
): Promise<DepreciationToPost[]> {
  const fiscalYear = await client.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } })
  if (!fiscalYear) return []
  const assets = await client.fixedAsset.findMany({
    where: {
      companyId,
      isActive: true,
      depreciationMethod: { not: 'none' },
      depreciationStartDate: { lte: fiscalYear.endDate },
      OR: [{ disposalDate: null }, { disposalDate: { gte: fiscalYear.startDate } }],
    },
    include: {
      expenseAccount: { select: { code: true, label: true } },
      depreciationAccount: { select: { code: true, label: true } },
      depreciations: { where: { fiscalYearId } },
    },
    orderBy: { acquisitionDate: 'asc' },
  })

  const out: DepreciationToPost[] = []
  for (const asset of assets) {
    const base = {
      fixedAssetId: asset.id,
      label: asset.label,
      expenseAccount: asset.expenseAccount,
      depreciationAccount: asset.depreciationAccount,
    }
    if (asset.depreciations.length > 0) {
      for (const record of asset.depreciations) {
        const amountCents = (parseCents(record.amount) ?? 0)
        if (!record.accountingEntryId && amountCents > 0) out.push({ ...base, recordId: record.id, amountCents })
      }
      continue
    }
    const plan = buildDepreciationPlan({
      acquisitionValue: asset.acquisitionValue,
      amortizableAmount: asset.amortizableAmount,
      depreciationMethod: asset.depreciationMethod,
      depreciationRate: asset.depreciationRate,
      depreciationDuration: asset.depreciationDuration,
      decliningCoefficient: asset.decliningCoefficient,
      depreciationStartDate: asset.depreciationStartDate,
    })
    const end =
      asset.disposalDate && asset.disposalDate < fiscalYear.endDate ? asset.disposalDate : fiscalYear.endDate
    const amountCents = sumPlanCentsForPeriod(plan, fiscalYear.startDate, end)
    if (amountCents > 0) out.push({ ...base, recordId: null, amountCents })
  }
  return out
}

/**
 * Books the missing depreciation entries of a fiscal year, in one
 * transaction. Returns what was booked.
 */
export async function generateDepreciationEntries(
  companyId: string,
  fiscalYearId: string
): Promise<{ count: number; totalCents: number; entries: Array<{ fixedAssetId: string; entryId: string; amountCents: number }> }> {
  return prisma.$transaction(
    async (tx) => {
      const fiscalYear = await lockFiscalYearRow(tx, fiscalYearId, companyId)
      if (!fiscalYear) throw new NotFoundError('Exercice comptable introuvable')
      if (fiscalYear.closed) throw new ClosedFiscalYearError(fiscalYear.year)

      const items = await findUnpostedDepreciation(companyId, fiscalYearId, tx)
      if (items.length === 0) return { count: 0, totalCents: 0, entries: [] }

      const journal = await ensureJournal(tx, companyId, OD_JOURNAL)
      const accountIds = await ensureAccounts(
        tx,
        companyId,
        fiscalYearId,
        items.flatMap((i) => [i.expenseAccount, i.depreciationAccount])
      )
      const entries: Array<{ fixedAssetId: string; entryId: string; amountCents: number }> = []
      for (const item of items) {
        const entry = await createValidatedEntry(tx, {
          companyId,
          fiscalYearId,
          journalId: journal.id,
          date: fiscalYear.endDate,
          description: `Dotation aux amortissements ${fiscalYear.year} - ${item.label}`,
          reference: `DOT-${fiscalYear.year}-${item.fixedAssetId.slice(-8)}`,
          lines: [
            { code: item.expenseAccount.code, debitCents: item.amountCents, creditCents: 0 },
            { code: item.depreciationAccount.code, debitCents: 0, creditCents: item.amountCents },
          ],
          lineDescription: () => `Dotation aux amortissements - ${item.label}`,
          accountIds,
        })
        if (item.recordId) {
          await tx.fixedAssetDepreciation.update({
            where: { id: item.recordId },
            data: { accountingEntryId: entry.id },
          })
        } else {
          await tx.fixedAssetDepreciation.create({
            data: {
              companyId,
              fixedAssetId: item.fixedAssetId,
              fiscalYearId,
              periodType: 'year',
              monthIndex: null,
              year: fiscalYear.endDate.getUTCFullYear(),
              amount: (item.amountCents / 100).toFixed(2),
              note: `Dotation ${fiscalYear.year}`,
              accountingEntryId: entry.id,
            },
          })
        }
        entries.push({ fixedAssetId: item.fixedAssetId, entryId: entry.id, amountCents: item.amountCents })
      }
      return {
        count: entries.length,
        totalCents: entries.reduce((s, e) => s + e.amountCents, 0),
        entries,
      }
    },
    { maxWait: 10_000, timeout: 60_000 }
  )
}
