/**
 * Depreciation records of a fixed asset (fixed_asset_depreciations): the
 * amount depreciated for a fiscal year or one of its months, as the user
 * entered it. A record is not an accounting entry: it is booked on demand
 * (postDepreciationRecord) or linked to an existing entry.
 *
 * Booking a record writes a validated OD entry, debit the expense account
 * (6811, dotations aux amortissements) and credit the depreciation account
 * (28) (PCG art. 214-13; chart of accounts, comptes 6811 and 28), under the
 * lock of the fiscal year row, so a record is never booked twice and never
 * in a closed year (PCG art. 1031-4).
 *
 * Every function is scoped by company and asset: a record of another asset
 * or company is a 404.
 */

import { prisma } from '@/lib/prisma'
import { ClosedFiscalYearError, ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { createValidatedEntry, ensureAccounts, ensureJournal } from '@/lib/accounting/fiscal-year-closure/ledger'
import { lockFiscalYearRow } from '@/lib/accounting/fiscal-year-closure/lock'
import { centsToDecimal, fromCents, sumCents, toCents } from '@/lib/utils/money'
import { buildDepreciationPlan, sumPlanCentsForPeriod } from './depreciation-plan'
import { FIXED_ASSET_NOT_FOUND } from './read-fixed-assets.service'
import type { SaveDepreciationRecordInput } from './schemas'

export const DEPRECIATION_RECORD_NOT_FOUND = 'Amortissement introuvable'
const NOT_DEPRECIABLE = "Cette immobilisation n'est pas amortissable"
const OD_JOURNAL = { code: 'OD', label: 'Opérations diverses' }

const centsOf = (value: { toString(): string }): number => toCents(value) ?? 0

export interface DepreciationPeriod {
  /** Calendar year of the period (the month's year, or the year the fiscal year starts in). */
  calendarYear: number
  /** 0 to 11 for a month, null for the whole fiscal year. */
  monthIndex: number | null
  start: Date
  end: Date
}

/**
 * The period of a record: the whole fiscal year, or one calendar month of it
 * clamped to the fiscal year. A month index before the first month of a
 * fiscal year spanning two calendar years is a month of its second year.
 */
export function depreciationPeriod(
  fiscalYear: { startDate: Date; endDate: Date },
  periodType: 'month' | 'year',
  monthIndex: number | null | undefined,
): DepreciationPeriod {
  const fyStart = new Date(fiscalYear.startDate)
  const fyEnd = new Date(fiscalYear.endDate)
  if (periodType === 'year') {
    return { calendarYear: fyStart.getUTCFullYear(), monthIndex: null, start: fyStart, end: fyEnd }
  }
  if (monthIndex === null || monthIndex === undefined || monthIndex < 0 || monthIndex > 11) {
    throw new ValidationError("Indiquez le mois (0 à 11) d'un amortissement mensuel")
  }
  const calendarYear =
    fyStart.getUTCFullYear() === fyEnd.getUTCFullYear() || monthIndex >= fyStart.getUTCMonth()
      ? fyStart.getUTCFullYear()
      : fyEnd.getUTCFullYear()
  const monthStart = new Date(Date.UTC(calendarYear, monthIndex, 1))
  const monthEnd = new Date(Date.UTC(calendarYear, monthIndex + 1, 0))
  return {
    calendarYear,
    monthIndex,
    start: monthStart < fyStart ? fyStart : monthStart,
    end: monthEnd > fyEnd ? fyEnd : monthEnd,
  }
}

/**
 * Records (or replaces) the depreciation of one period of a fixed asset:
 * the amount given, else the plan's amount for the period. One record per
 * (asset, fiscal year, period); `authorizeReplace` runs before an existing
 * record is replaced (replacing is an update).
 */
export async function saveDepreciationRecord(
  companyId: string,
  fixedAssetId: string,
  input: SaveDepreciationRecordInput,
  options: { authorizeReplace?: () => void } = {},
) {
  const fixedAsset = await prisma.fixedAsset.findFirst({ where: { id: fixedAssetId, companyId } })
  if (!fixedAsset) throw new NotFoundError(FIXED_ASSET_NOT_FOUND)
  if (fixedAsset.depreciationMethod === 'none') throw new ValidationError(NOT_DEPRECIABLE)

  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: input.fiscalYearId, companyId } })
  if (!fiscalYear) throw new NotFoundError('Exercice fiscal introuvable')

  const period = depreciationPeriod(fiscalYear, input.periodType, input.monthIndex)

  let amountCents: number
  if (input.amount !== null && input.amount !== undefined) {
    if (input.amount < 0) throw new ValidationError('Montant négatif')
    amountCents = toCents(input.amount) ?? 0
  } else {
    const plan = buildDepreciationPlan({
      acquisitionValue: fixedAsset.acquisitionValue,
      amortizableAmount: fixedAsset.amortizableAmount,
      depreciationMethod: fixedAsset.depreciationMethod,
      depreciationRate: fixedAsset.depreciationRate,
      depreciationDuration: fixedAsset.depreciationDuration,
      decliningCoefficient: fixedAsset.decliningCoefficient,
      depreciationStartDate: new Date(fixedAsset.depreciationStartDate),
    })
    amountCents = sumPlanCentsForPeriod(plan, period.start, period.end)
  }
  const amount = centsToDecimal(amountCents)
  const note = input.note ?? null

  // Find then create or update: Prisma upserts do not match a composite
  // unique key with a nullable column (monthIndex).
  const existing = await prisma.fixedAssetDepreciation.findFirst({
    where: { fixedAssetId, fiscalYearId: fiscalYear.id, periodType: input.periodType, monthIndex: period.monthIndex },
    select: { id: true },
  })
  if (existing) {
    options.authorizeReplace?.()
    return prisma.fixedAssetDepreciation.update({ where: { id: existing.id }, data: { amount, note } })
  }
  return prisma.fixedAssetDepreciation.create({
    data: {
      companyId,
      fixedAssetId,
      fiscalYearId: fiscalYear.id,
      periodType: input.periodType,
      monthIndex: period.monthIndex,
      year: period.calendarYear,
      amount,
      note,
    },
  })
}

/** The record of the asset with its fiscal year, else a 404. */
async function findRecord(companyId: string, fixedAssetId: string, recordId: string) {
  const record = await prisma.fixedAssetDepreciation.findFirst({
    where: { id: recordId, companyId, fixedAssetId },
    include: { fiscalYear: true },
  })
  if (!record) throw new NotFoundError(DEPRECIATION_RECORD_NOT_FOUND)
  return record
}

/** Deletes a depreciation record (not the entry it may be linked to). */
export async function deleteDepreciationRecord(companyId: string, fixedAssetId: string, recordId: string): Promise<void> {
  await findRecord(companyId, fixedAssetId, recordId)
  await prisma.fixedAssetDepreciation.delete({ where: { id: recordId } })
}

/**
 * Links a record to an existing entry of the company dated within the
 * record's fiscal year, or unlinks it (null). One entry may cover several
 * records (a yearly allowance booked for several assets).
 */
export async function linkDepreciationRecord(
  companyId: string,
  fixedAssetId: string,
  recordId: string,
  accountingEntryId: string | null,
) {
  const record = await findRecord(companyId, fixedAssetId, recordId)
  if (accountingEntryId) {
    const entry = await prisma.accountingEntry.findFirst({
      where: { id: accountingEntryId, companyId },
      select: { date: true },
    })
    if (!entry) throw new NotFoundError('Écriture introuvable')
    const entryDate = new Date(entry.date)
    if (entryDate < new Date(record.fiscalYear.startDate) || entryDate > new Date(record.fiscalYear.endDate)) {
      throw new ValidationError("L'écriture doit être dans le même exercice fiscal que l'amortissement")
    }
  }
  return prisma.fixedAssetDepreciation.update({
    where: { id: recordId },
    data: { accountingEntryId: accountingEntryId ?? null },
  })
}

/**
 * Entries a record could be linked to: the 100 latest entries of its fiscal
 * year, those that look like a depreciation allowance (a 68 debit and a 28
 * credit) first, with the number of other records already linked to each.
 */
export async function listLinkCandidates(companyId: string, fixedAssetId: string, recordId: string) {
  const record = await findRecord(companyId, fixedAssetId, recordId)
  const fyStart = new Date(record.fiscalYear.startDate)
  const fyEnd = new Date(record.fiscalYear.endDate)

  const [linked, entries] = await Promise.all([
    prisma.fixedAssetDepreciation.findMany({
      where: { companyId, accountingEntryId: { not: null }, NOT: { id: recordId } },
      select: { accountingEntryId: true },
    }),
    prisma.accountingEntry.findMany({
      where: { companyId, date: { gte: fyStart, lte: fyEnd } },
      select: {
        id: true,
        entryNumber: true,
        date: true,
        description: true,
        status: true,
        lines: { select: { debit: true, credit: true, account: { select: { code: true } } } },
      },
      orderBy: { date: 'desc' },
      take: 100,
    }),
  ])

  const linkCountByEntry = new Map<string, number>()
  for (const { accountingEntryId } of linked) {
    if (accountingEntryId) linkCountByEntry.set(accountingEntryId, (linkCountByEntry.get(accountingEntryId) ?? 0) + 1)
  }

  const candidates = entries.map((e) => {
    const hasExpense = e.lines.some((l) => l.account.code.startsWith('68') && centsOf(l.debit) > 0)
    const hasDepreciation = e.lines.some((l) => l.account.code.startsWith('28') && centsOf(l.credit) > 0)
    return {
      id: e.id,
      entryNumber: e.entryNumber,
      date: e.date,
      description: e.description,
      status: e.status,
      total: fromCents(Number(sumCents(e.lines.map((l) => centsOf(l.debit))))),
      looksLikeAmortization: hasExpense && hasDepreciation,
      alreadyLinkedCount: linkCountByEntry.get(e.id) ?? 0,
    }
  })
  candidates.sort((a, b) => {
    if (a.looksLikeAmortization !== b.looksLikeAmortization) return a.looksLikeAmortization ? -1 : 1
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  return {
    recordAmount: fromCents(centsOf(record.amount)),
    fiscalYear: {
      id: record.fiscalYear.id,
      year: record.fiscalYear.year,
      startDate: record.fiscalYear.startDate,
      endDate: record.fiscalYear.endDate,
    },
    candidates,
  }
}

/**
 * Books one record: a validated OD entry (68 debit, 28 credit) on the last
 * day of its month (monthly record, within the fiscal year) or of its fiscal
 * year, with the accounts of that fiscal year, and links the record to it.
 * 409 when the record is already booked or the year is closed.
 */
export async function postDepreciationRecord(companyId: string, fixedAssetId: string, recordId: string) {
  const found = await prisma.fixedAssetDepreciation.findFirst({
    where: { id: recordId, companyId, fixedAssetId },
    select: { fiscalYearId: true },
  })
  if (!found) throw new NotFoundError(DEPRECIATION_RECORD_NOT_FOUND)

  const { record, entry, entryDate } = await prisma.$transaction(async (tx) => {
    const fiscalYear = await lockFiscalYearRow(tx, found.fiscalYearId)
    if (!fiscalYear) throw new ValidationError('Exercice introuvable')
    if (fiscalYear.closed) throw new ClosedFiscalYearError(fiscalYear.year)

    const current = await tx.fixedAssetDepreciation.findUniqueOrThrow({
      where: { id: recordId },
      include: {
        fixedAsset: {
          include: {
            expenseAccount: { select: { code: true, label: true } },
            depreciationAccount: { select: { code: true, label: true } },
          },
        },
      },
    })
    if (current.accountingEntryId) throw new ConflictError('Une écriture est déjà liée à cet amortissement')
    const amountCents = centsOf(current.amount)
    if (amountCents <= 0) throw new ValidationError('Montant nul')
    const asset = current.fixedAsset
    if (asset.depreciationMethod === 'none') throw new ValidationError(NOT_DEPRECIABLE)

    // Last day of the month (monthly record) or of the fiscal year, within the year.
    let date = fiscalYear.endDate
    let periodLabel = `Exercice ${fiscalYear.year}`
    if (current.periodType === 'month') {
      const monthEnd = new Date(Date.UTC(current.year, (current.monthIndex ?? 0) + 1, 0))
      date = monthEnd > fiscalYear.endDate ? fiscalYear.endDate : monthEnd < fiscalYear.startDate ? fiscalYear.startDate : monthEnd
      periodLabel = monthEnd.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    }

    const journal = await ensureJournal(tx, companyId, OD_JOURNAL)
    const accountIds = await ensureAccounts(tx, companyId, current.fiscalYearId, [asset.expenseAccount, asset.depreciationAccount])
    const created = await createValidatedEntry(tx, {
      companyId,
      fiscalYearId: current.fiscalYearId,
      journalId: journal.id,
      date,
      description: `Amortissement ${asset.label} - ${periodLabel}`,
      reference: `DOT-${fiscalYear.year}-${asset.id.slice(-8)}`,
      lines: [
        { code: asset.expenseAccount.code, debitCents: amountCents, creditCents: 0 },
        { code: asset.depreciationAccount.code, debitCents: 0, creditCents: amountCents },
      ],
      lineDescription: () => `Amortissement ${asset.label}`,
      accountIds,
    })
    const updated = await tx.fixedAssetDepreciation.update({ where: { id: recordId }, data: { accountingEntryId: created.id } })
    return { record: updated, entry: created, entryDate: date }
  })

  return { record, accountingEntry: { id: entry.id, entryNumber: entry.entryNumber, date: entryDate } }
}
