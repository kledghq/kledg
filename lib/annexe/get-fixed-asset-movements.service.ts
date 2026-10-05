/**
 * Loads the fixed asset report of a fiscal year (forms 2054-SD, 2055-SD and
 * 2033-C-SD, fixed-asset-report.ts): the validated entries of the year on
 * the class 2 accounts and on the écarts de réévaluation (105), the
 * "Actif immobilisé" of the complete balance sheet and the fixed asset
 * register with its depreciation plans and records.
 *
 * Every query is scoped by the company the route resolved; the fiscal year
 * must be the company's (404 otherwise). Read with reports:read.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ownedFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'
import { CLOSING_JOURNAL } from '@/lib/accounting/fiscal-year-closure/constants'
import { isOpeningJournal } from '@/lib/fec/format'
import { buildDepreciationPlan } from '@/lib/fixed-assets/depreciation-plan'
import { cumulativeDepreciationCents } from '@/lib/fixed-assets/cumulative-depreciation'
import { generateBalanceSheet } from '@/lib/reports/balance-sheet/generate-balance-sheet.service'
import type { BalanceSheetLine } from '@/lib/reports/balance-sheet/types'
import { addUtcDays, calendarDayOf } from '@/lib/utils/date'
import { parseCents, toCents } from '@/lib/utils/money'
import { buildFixedAssetReport, type FixedAssetReport, type RegisterAsset } from './fixed-asset-report'
import type { LedgerLine } from './movements'

export const FiscalYearQuerySchema = z.object({ fiscalYearId: z.string({ error: "L'exercice est requis" }).min(1, "L'exercice est requis").max(64) })

const day = (value: Date) => calendarDayOf(value) as string
const cents = (value: { toString(): string } | null | undefined) => (value == null ? 0 : (parseCents(value) ?? 0))

/** The line of the balance sheet carrying `formCode`, searched through the groups. */
function findLine(lines: readonly BalanceSheetLine[], formCode: string): BalanceSheetLine | null {
  for (const line of lines) {
    if (line.formCode === formCode) return line
    const child = line.children ? findLine(line.children, formCode) : null
    if (child) return child
  }
  return null
}

/** Validated lines of the year on fixed assets (20 to 28), impairments (29) and revaluation reserves (105), closing entry excluded. */
async function loadLedgerLines(companyId: string, fiscalYearId: string) {
  const rows = await prisma.entryLine.findMany({
    where: {
      accountFiscalYearId: fiscalYearId,
      accountingEntry: { companyId, fiscalYearId, status: 'validated', journal: { code: { not: CLOSING_JOURNAL.code } } },
      OR: [{ account: { code: { startsWith: '2' } } }, { account: { code: { startsWith: '105' } } }],
    },
    select: {
      accountingEntryId: true,
      debit: true,
      credit: true,
      account: { select: { code: true } },
      accountingEntry: { select: { reversalOfId: true, journal: { select: { code: true } } } },
    },
  })
  return rows.map(
    (r): LedgerLine => ({
      entryId: r.accountingEntryId,
      reversalOfId: r.accountingEntry.reversalOfId,
      opening: isOpeningJournal(r.accountingEntry.journal.code),
      code: r.account.code,
      debitCents: cents(r.debit),
      creditCents: cents(r.credit),
    }),
  )
}

/** The register with each asset's depreciation accumulated at the start and at the end of the year. */
async function loadRegister(companyId: string, fy: { startDate: Date; endDate: Date }): Promise<RegisterAsset[]> {
  const [assets, years] = await Promise.all([
    prisma.fixedAsset.findMany({
      where: { companyId },
      select: {
        id: true,
        label: true,
        acquisitionDate: true,
        acquisitionValue: true,
        amortizableAmount: true,
        disposalDate: true,
        depreciationMethod: true,
        depreciationRate: true,
        depreciationDuration: true,
        decliningCoefficient: true,
        depreciationStartDate: true,
        assetAccount: { select: { code: true } },
        depreciationAccount: { select: { code: true } },
        depreciations: { select: { fiscalYearId: true, amount: true } },
      },
      orderBy: { acquisitionDate: 'asc' },
    }),
    prisma.fiscalYear.findMany({ where: { companyId }, select: { id: true, startDate: true, endDate: true } }),
  ])
  const dayBefore = addUtcDays(fy.startDate, -1)
  return assets.map((asset) => {
    const plan = buildDepreciationPlan(asset)
    const recorded = new Map<string, number>()
    for (const r of asset.depreciations) recorded.set(r.fiscalYearId, (recorded.get(r.fiscalYearId) ?? 0) + cents(r.amount))
    const input = { plan, fiscalYears: years, recordedByFiscalYear: recorded, disposalDate: asset.disposalDate }
    return {
      id: asset.id,
      label: asset.label,
      assetAccountCode: asset.assetAccount.code,
      depreciationAccountCode: asset.depreciationAccount.code,
      grossCents: toCents(asset.acquisitionValue) ?? 0,
      acquisitionDate: day(asset.acquisitionDate),
      disposalDate: asset.disposalDate ? day(asset.disposalDate) : null,
      depreciationAtStartCents: cumulativeDepreciationCents({ ...input, until: dayBefore }),
      depreciationAtEndCents: cumulativeDepreciationCents({ ...input, until: fy.endDate }),
    }
  })
}

export async function getFixedAssetMovements(companyId: string, fiscalYearId: string): Promise<FixedAssetReport> {
  const fy = await ownedFiscalYear(companyId, fiscalYearId)
  const [lines, register, sheet, draftEntries] = await Promise.all([
    loadLedgerLines(companyId, fy.id),
    loadRegister(companyId, fy),
    generateBalanceSheet(companyId, fy.id, 'complete'),
    prisma.accountingEntry.count({
      where: { companyId, fiscalYearId: fy.id, status: 'draft', lines: { some: { account: { code: { startsWith: '2' } } } } },
    }),
  ])
  const fixed = findLine(sheet.actif.lines, 'BJ')
  const impairmentCents = lines.filter((l) => l.code.startsWith('29')).reduce((sum, l) => sum + l.creditCents - l.debitCents, 0)
  return buildFixedAssetReport({
    fiscalYear: { id: fy.id, year: fy.year, startDate: day(fy.startDate), endDate: day(fy.endDate) },
    lines,
    impairmentCents,
    balanceSheet: fixed ? { grossCents: toCents(fixed.brut ?? fixed.value) ?? 0, depreciationCents: toCents(fixed.amortissements ?? 0) ?? 0 } : null,
    register,
    draftEntries,
  })
}
