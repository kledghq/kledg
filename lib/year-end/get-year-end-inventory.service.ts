/**
 * Year-end inventory of a fiscal year (inventaire de clôture): every
 * provision, impairment and investment grant of the company with what it
 * needs at this closing (lib/year-end/inventory.ts for the rules). Read
 * only; the entries are prepared by prepare-year-end-entries.service.ts.
 *
 * Every query is scoped by company; the fiscal year of another company is
 * a 404. Takes a client so the closing checks and the preparation read it
 * inside their transaction.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { calendarDayOf } from '@/lib/utils/date'
import { parseCents, toCents } from '@/lib/utils/money'
import { buildDepreciationPlan } from '@/lib/fixed-assets/depreciation-plan'
import { cumulativeDepreciationCents, type CumulativeDepreciationInput } from '@/lib/fixed-assets/cumulative-depreciation'
import { allowanceAccountLabel, type ProvisionCategory, type ProvisionNature } from '@/lib/provisions/rules'
import type { FinancedAsset, GrantSpreading } from '@/lib/investment-grants/schedule'
import { grantYear, provisionYear, type GrantYear, type LinkedEntry, type ProvisionYear, type YearRef } from './inventory'

type Client = Prisma.TransactionClient | typeof prisma

export const FISCAL_YEAR_NOT_FOUND = 'Exercice introuvable pour cette société.'

const ENTRY_SELECT = {
  id: true,
  entryNumber: true,
  status: true,
  fiscalYearId: true,
  reversedBy: { select: { id: true } },
  lines: { select: { debit: true, credit: true, account: { select: { code: true } } } },
} as const

type EntryRow = Prisma.AccountingEntryGetPayload<{ select: typeof ENTRY_SELECT }>

const cents = (value: Prisma.Decimal | null | undefined) => (value == null ? 0 : (parseCents(value) ?? 0))
const day = (value: Date) => calendarDayOf(value) as string

function linkedEntry(row: EntryRow | null): LinkedEntry | null {
  if (!row) return null
  return {
    id: row.id,
    entryNumber: row.entryNumber,
    status: row.status === 'validated' ? 'validated' : 'draft',
    fiscalYearId: row.fiscalYearId,
    reversed: row.reversedBy !== null,
    lines: row.lines.map((l) => ({ accountCode: l.account.code, debitCents: cents(l.debit), creditCents: cents(l.credit) })),
  }
}

export interface AssetRef {
  id: string
  label: string
  /** Net book value at the end of the fiscal year, in cents (gross value less accumulated depreciation). */
  netBookValueCents: number
}

export interface ProvisionView extends ProvisionYear {
  id: string
  category: ProvisionCategory
  label: string
  justification: string
  accountCode: string
  accountLabel: string
  nature: ProvisionNature
  taxDeductible: boolean
  reversible: boolean
  fixedAsset: AssetRef | null
  tiersCode: string | null
  openedOn: string
  closedOn: string | null
  carriedCents: number
}

export interface GrantView extends GrantYear {
  id: string
  label: string
  grantor: string | null
  amountCents: number
  grantedOn: string
  spreading: GrantSpreading
  durationYears: number | null
  fixedAsset: AssetRef | null
  accountCode: string
  transferAccountCode: string
  incomeAccountCode: string
  carriedCents: number
  notes: string | null
}

export interface YearEndInventory {
  fiscalYear: YearRef
  provisions: ProvisionView[]
  grants: GrantView[]
  totals: {
    /** Dotations still to book (cents). */
    dotationsCents: number
    /** Reprises still to book (cents, positive). */
    reprisesCents: number
    /** Grant shares still to transfer (cents). */
    transfersCents: number
    /** Items without the balance required at this closing. */
    toAssess: number
    /** Items whose linked entry no longer matches. */
    toCorrect: number
  }
}

/** The financed or impaired asset at the end of the year: depreciation, net book value, disposal. */
function assetAtYearEnd(
  asset: Prisma.FixedAssetGetPayload<{ include: { depreciations: { select: { fiscalYearId: true; amount: true } } } }>,
  years: Array<{ id: string; startDate: Date; endDate: Date }>,
  year: YearRef,
  endDate: Date,
): { financed: FinancedAsset; ref: AssetRef } {
  const plan = buildDepreciationPlan({
    acquisitionValue: asset.acquisitionValue,
    amortizableAmount: asset.amortizableAmount,
    depreciationMethod: asset.depreciationMethod,
    depreciationRate: asset.depreciationRate,
    depreciationDuration: asset.depreciationDuration,
    decliningCoefficient: asset.decliningCoefficient,
    depreciationStartDate: asset.depreciationStartDate,
  })
  const recorded = new Map<string, number>()
  for (const r of asset.depreciations) recorded.set(r.fiscalYearId, (recorded.get(r.fiscalYearId) ?? 0) + cents(r.amount))
  const input: CumulativeDepreciationInput = { plan, fiscalYears: years, recordedByFiscalYear: recorded, until: endDate, disposalDate: asset.disposalDate }
  const depreciatedCents = cumulativeDepreciationCents(input)
  const grossCents = toCents(asset.acquisitionValue) ?? 0
  const disposalDay = asset.disposalDate ? day(asset.disposalDate) : null
  return {
    financed: {
      depreciable: plan.method !== 'none' && plan.byMonth.size > 0,
      baseCents: toCents(plan.baseAmount) ?? 0,
      depreciatedCents,
      disposed: disposalDay !== null && disposalDay <= year.endDate,
    },
    ref: { id: asset.id, label: asset.label, netBookValueCents: Math.max(0, grossCents - depreciatedCents) },
  }
}

export async function getYearEndInventory(companyId: string, fiscalYearId: string, client: Client = prisma): Promise<YearEndInventory> {
  const yearRows = await client.fiscalYear.findMany({
    where: { companyId },
    select: { id: true, year: true, startDate: true, endDate: true, isClosed: true },
    orderBy: { startDate: 'asc' },
  })
  const row = yearRows.find((y) => y.id === fiscalYearId)
  if (!row) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
  const years: YearRef[] = yearRows.map((y) => ({ id: y.id, year: y.year, startDate: day(y.startDate), endDate: day(y.endDate), isClosed: y.isClosed }))
  const year = years.find((y) => y.id === fiscalYearId)!

  // Sequential: the client may be the closing's transaction
  const provisions = await client.provision.findMany({
    where: { companyId },
    include: { assessments: { include: { entry: { select: ENTRY_SELECT } } } },
    orderBy: [{ category: 'asc' }, { openedOn: 'asc' }, { createdAt: 'asc' }],
  })
  const grants = await client.investmentGrant.findMany({
    where: { companyId },
    include: { transfers: { include: { entry: { select: ENTRY_SELECT } } } },
    orderBy: [{ grantedOn: 'asc' }, { createdAt: 'asc' }],
  })
  const assetIds = [...new Set([...provisions, ...grants].flatMap((p) => (p.fixedAssetId ? [p.fixedAssetId] : [])))]
  const assets = assetIds.length
    ? await client.fixedAsset.findMany({
        where: { companyId, id: { in: assetIds } },
        include: { depreciations: { select: { fiscalYearId: true, amount: true } } },
      })
    : []
  const assetsAtEnd = new Map(assets.map((a) => [a.id, assetAtYearEnd(a, yearRows, year, row.endDate)]))

  const provisionViews: ProvisionView[] = provisions.map((p) => {
    const computed = provisionYear(
      {
        id: p.id,
        category: p.category,
        label: p.label,
        accountCode: p.accountCode,
        nature: p.nature,
        reversible: p.reversible,
        openedOn: day(p.openedOn),
        closedOn: p.closedOn ? day(p.closedOn) : null,
        carriedCents: cents(p.carriedAmount),
        assessments: p.assessments.map((a) => ({
          fiscalYearId: a.fiscalYearId,
          amountCents: cents(a.amount),
          currentValueCents: a.currentValue === null ? null : cents(a.currentValue),
          basis: a.basis,
          entry: linkedEntry(a.entry),
        })),
      },
      year,
      years,
    )
    return {
      ...computed,
      id: p.id,
      category: p.category,
      label: p.label,
      justification: p.justification,
      accountCode: p.accountCode,
      accountLabel: allowanceAccountLabel(p.category, p.accountCode),
      nature: p.nature,
      taxDeductible: p.taxDeductible,
      reversible: p.reversible,
      fixedAsset: p.fixedAssetId ? (assetsAtEnd.get(p.fixedAssetId)?.ref ?? null) : null,
      tiersCode: p.tiersCode,
      openedOn: day(p.openedOn),
      closedOn: p.closedOn ? day(p.closedOn) : null,
      carriedCents: cents(p.carriedAmount),
    }
  })

  const grantViews: GrantView[] = grants.map((g) => {
    const asset = g.fixedAssetId ? (assetsAtEnd.get(g.fixedAssetId) ?? null) : null
    const computed = grantYear(
      {
        id: g.id,
        label: g.label,
        amountCents: cents(g.amount),
        spreading: g.spreading,
        grantedOn: day(g.grantedOn),
        durationYears: g.durationYears,
        transferAccountCode: g.transferAccountCode,
        carriedCents: cents(g.carriedAmount),
        transfers: g.transfers.map((t) => ({ fiscalYearId: t.fiscalYearId, entry: linkedEntry(t.entry) })),
      },
      year,
      years,
      asset?.financed ?? null,
    )
    return {
      ...computed,
      id: g.id,
      label: g.label,
      grantor: g.grantor,
      amountCents: cents(g.amount),
      grantedOn: day(g.grantedOn),
      spreading: g.spreading,
      durationYears: g.durationYears,
      fixedAsset: asset?.ref ?? null,
      accountCode: g.accountCode,
      transferAccountCode: g.transferAccountCode,
      incomeAccountCode: g.incomeAccountCode,
      carriedCents: cents(g.carriedAmount),
      notes: g.notes,
    }
  })

  const live = provisionViews.filter((p) => p.status !== 'not_in_year')
  return {
    fiscalYear: year,
    provisions: provisionViews,
    grants: grantViews,
    totals: {
      dotationsCents: live.filter((p) => p.status === 'to_post' && p.proposedCents > 0).reduce((s, p) => s + p.proposedCents, 0),
      reprisesCents: live.filter((p) => p.status === 'to_post' && p.proposedCents < 0).reduce((s, p) => s - p.proposedCents, 0),
      transfersCents: grantViews.filter((g) => g.status === 'to_post').reduce((s, g) => s + g.proposedCents, 0),
      toAssess: live.filter((p) => p.status === 'to_assess').length,
      toCorrect: live.filter((p) => p.status === 'to_correct').length + grantViews.filter((g) => g.status === 'to_correct').length,
    },
  }
}
