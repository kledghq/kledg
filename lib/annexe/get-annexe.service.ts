/**
 * The annexe of a fiscal year as the page, the MCP tool, the approval pack
 * and the export read it: the books (validated entries, closing entry
 * excluded), the fixed asset report, the register of methods, the
 * participations of a holding, the size category of the approval and the
 * answers the user saved (annexe_notes), built by build-annexe.ts.
 *
 * Every query is scoped by the company the route resolved; the fiscal year
 * must be the company's (404 otherwise). Read with reports:read. The
 * participations of a holding are read through a GroupAccess (a subsidiary
 * the user cannot read is counted, never read, lib/group).
 */

import { prisma } from '@/lib/prisma'
import { ownedFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'
import { CLOSING_JOURNAL } from '@/lib/accounting/fiscal-year-closure/constants'
import { isOpeningJournal } from '@/lib/fec/format'
import { getApproval } from '@/lib/approval/get-approval.service'
import type { SizeCategory } from '@/lib/approval/size'
import { getParticipations } from '@/lib/group/get-participations.service'
import type { GroupAccess } from '@/lib/management-fees/access'
import { calendarDayOf } from '@/lib/utils/date'
import { parseCents, toCents } from '@/lib/utils/money'
import { buildAnnexe, type AccountYear, type Annexe, type AnnexeData, type RegisterSummary } from './build-annexe'
import { lineOf, FORM_2054, type Rubrique } from './fixed-asset-forms'
import { getFixedAssetMovements } from './get-fixed-asset-movements.service'
import { listAccountingChanges, listAccountingMethods } from './methods/manage-accounting-methods.service'
import { AnnexeDetailsSchema, emptyAnnexeDetails, type AnnexeDetails } from './schemas'

const day = (value: Date) => calendarDayOf(value) as string
const cents = (value: { toString(): string } | null | undefined) => (value == null ? 0 : (parseCents(value) ?? 0))

/** Opening balance (opening entries) and movements of the year (other entries, closing excluded) of every account, from validated entries. */
async function loadAccountYears(companyId: string, fiscalYearId: string): Promise<AccountYear[]> {
  const journals = await prisma.journal.findMany({ where: { companyId }, select: { code: true } })
  const opening = journals.map((j) => j.code).filter(isOpeningJournal)
  const where = (codes: { in: string[] } | { notIn: string[] }) => ({
    accountFiscalYearId: fiscalYearId,
    accountingEntry: { companyId, fiscalYearId, status: 'validated', journal: { code: codes } },
  })
  const [openings, movements] = await Promise.all([
    opening.length > 0 ? prisma.entryLine.groupBy({ by: ['accountId'], where: where({ in: opening }), _sum: { debit: true, credit: true } }) : Promise.resolve([]),
    prisma.entryLine.groupBy({ by: ['accountId'], where: where({ notIn: [...opening, CLOSING_JOURNAL.code] }), _sum: { debit: true, credit: true } }),
  ])
  const ids = [...new Set([...openings, ...movements].map((r) => r.accountId))]
  const accounts = await prisma.account.findMany({ where: { id: { in: ids }, companyId }, select: { id: true, code: true, label: true } })
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const rows = new Map<string, AccountYear>()
  const row = (accountId: string) => {
    const account = byId.get(accountId)
    if (!account) return null
    const current = rows.get(account.code) ?? { code: account.code, label: account.label, openingCents: 0, debitCents: 0, creditCents: 0 }
    rows.set(account.code, current)
    return current
  }
  for (const o of openings) {
    const r = row(o.accountId)
    if (r) r.openingCents += cents(o._sum.debit) - cents(o._sum.credit)
  }
  for (const m of movements) {
    const r = row(m.accountId)
    if (!r) continue
    r.debitCents += cents(m._sum.debit)
    r.creditCents += cents(m._sum.credit)
  }
  return [...rows.values()].sort((a, b) => a.code.localeCompare(b.code))
}

const METHOD_LABELS: Record<string, string> = { linear: 'linéaire', declining: 'dégressif', none: 'non amortissable' }

/** Depreciation modes and durations of the register by rubrique (PCG art. 832-1, 1° and 2°), assets present at the closing. */
async function registerSummary(companyId: string, endDate: Date): Promise<RegisterSummary[]> {
  const assets = await prisma.fixedAsset.findMany({
    where: { companyId, acquisitionDate: { lte: endDate }, OR: [{ disposalDate: null }, { disposalDate: { gt: endDate } }] },
    select: { depreciationMethod: true, depreciationDuration: true, depreciationRate: true, assetAccount: { select: { code: true } } },
  })
  const by = new Map<Rubrique, RegisterSummary>()
  for (const a of assets) {
    const rubrique = lineOf(FORM_2054, a.assetAccount.code)?.rubrique ?? 'tangible'
    const s = by.get(rubrique) ?? { rubrique, methods: [], minYears: null, maxYears: null, assets: 0 }
    s.assets++
    const method = METHOD_LABELS[a.depreciationMethod] ?? a.depreciationMethod
    if (a.depreciationMethod !== 'none' && !s.methods.includes(method)) s.methods.push(method)
    const rate = a.depreciationRate === null ? null : Number(a.depreciationRate.toString())
    const years = a.depreciationDuration ?? (rate && rate > 0 ? Math.round(100 / rate) : null)
    if (years !== null && a.depreciationMethod !== 'none') {
      s.minYears = s.minYears === null ? years : Math.min(s.minYears, years)
      s.maxYears = s.maxYears === null ? years : Math.max(s.maxYears, years)
    }
    by.set(rubrique, s)
  }
  return (['intangible', 'tangible', 'financial'] as const).flatMap((r) => (by.has(r) ? [by.get(r)!] : []))
}

/** The saved answers, read leniently: a stored value that no longer validates starts again from empty. */
export function parseStoredAnnexeDetails(json: unknown): AnnexeDetails {
  const parsed = AnnexeDetailsSchema.safeParse(json ?? {})
  return parsed.success ? parsed.data : emptyAnnexeDetails()
}

export interface AnnexeContext {
  category: SizeCategory
  confirmed: boolean
  groupMember: boolean | null
  employees: number | null
  /** Reads the participations of a holding; null leaves them unread (titres 261 are then asked when present). */
  access: GroupAccess | null
}

export interface AnnexeView {
  company: { name: string; siren: string }
  fiscalYear: AnnexeData['fiscalYear']
  annexe: Annexe
  details: AnnexeDetails
  saved: { updatedAt: string } | null
}

/** The annexe once the size category is known (the approval pack calls this with its own). */
export async function loadAnnexe(companyId: string, fiscalYearId: string, context: AnnexeContext): Promise<AnnexeView> {
  const fy = await ownedFiscalYear(companyId, fiscalYearId)
  const [company, accounts, fixedAssets, register, methods, changes, row] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, siren: true, totalShares: true, shareNominalValue: true, shareCapital: true, corporateTaxRegime: true } }),
    loadAccountYears(companyId, fy.id),
    getFixedAssetMovements(companyId, fy.id),
    registerSummary(companyId, fy.endDate),
    listAccountingMethods(companyId),
    listAccountingChanges(companyId, fy.id),
    prisma.annexeNote.findUnique({ where: { fiscalYearId_companyId: { fiscalYearId: fy.id, companyId } }, select: { details: true, updatedAt: true } }),
  ])
  let participations: AnnexeData['participations'] = null
  if (context.access) {
    const report = await getParticipations(companyId, { fiscalYearId: fy.id }, context.access)
    participations = {
      rows: report.rows.map((r) => ({
        name: r.name,
        siren: r.siren,
        ownershipBp: r.ownershipBp,
        capitalCents: r.capitalCents,
        equityCents: r.capitauxPropresCents,
        bookValueGrossCents: r.bookValueGrossCents,
        bookValueNetCents: r.bookValueNetCents,
        loansCents: r.loansCents,
        revenueCents: r.chiffreAffairesCents,
        resultCents: r.resultatCents,
        dividendsCents: r.dividendsCents,
      })),
      unattributedCents: report.unattributed.filter((u) => u.accountCode.startsWith('261')).reduce((s, u) => s + u.cents, 0),
    }
  }
  const resultCents = accounts.filter((a) => a.code.startsWith('6') || a.code.startsWith('7')).reduce((s, a) => s + a.creditCents - a.debitCents - a.openingCents, 0)
  const details = parseStoredAnnexeDetails(row?.details)
  const data: AnnexeData = {
    company: {
      name: company.name,
      siren: company.siren,
      totalShares: company.totalShares,
      nominalCents: company.shareNominalValue === null ? null : toCents(company.shareNominalValue),
      shareCapitalCents: company.shareCapital === null ? null : toCents(company.shareCapital),
      corporateTaxRegime: company.corporateTaxRegime,
    },
    fiscalYear: { id: fy.id, year: fy.year, startDate: day(fy.startDate), endDate: day(fy.endDate), isClosed: fy.isClosed },
    size: { category: context.category, confirmed: context.confirmed },
    groupMember: context.groupMember,
    approvalEmployees: context.employees,
    accounts,
    resultCents,
    fixedAssets,
    register,
    methods,
    changes,
    participations,
  }
  return {
    company: { name: company.name, siren: company.siren },
    fiscalYear: data.fiscalYear,
    annexe: buildAnnexe(data, details),
    details,
    saved: row ? { updatedAt: row.updatedAt.toISOString() } : null,
  }
}

/** The annexe of a fiscal year, with the size category of its approval (confirmed, else proposed from the books). */
export async function getAnnexe(companyId: string, fiscalYearId: string, access: GroupAccess | null, now?: Date): Promise<AnnexeView> {
  const approval = await getApproval(companyId, fiscalYearId, now, { annexe: false })
  const size = approval.pack.size
  return loadAnnexe(companyId, fiscalYearId, {
    category: size.confirmed ?? size.proposed,
    confirmed: size.confirmed !== null,
    groupMember: approval.details.groupMember ?? null,
    employees: approval.details.size.employees,
    access,
  })
}
