/**
 * The approval of a fiscal year's accounts, as the screen, the MCP tool and
 * the document export read it: the books and the company record
 * (ApprovalContext), the details the user saved, and the pack built from
 * both (pack.ts).
 *
 * Every query is scoped by the company the route resolved; the fiscal year
 * must be the company's (404 otherwise). Read with reports:read. Names only
 * for natural persons: birth data and addresses stay on their record.
 */

import { prisma } from '@/lib/prisma'
import { ownedFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'
import { loadYearBalances } from '@/lib/accounting/fiscal-year-closure/ledger'
import { CLOSING_JOURNAL } from '@/lib/accounting/fiscal-year-closure/constants'
import type { AllocationBalances } from '@/lib/accounting/result-allocation/compute'
import { generateBalanceSheet } from '@/lib/reports/balance-sheet/generate-balance-sheet.service'
import { getCapitalComposition } from '@/lib/reports/capital-composition/get-capital-composition.service'
import { parseDeadlineSettings } from '@/lib/deadlines/settings'
import { formatAddress } from '@/lib/utils/address'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { toCents } from '@/lib/utils/money'
import { buildApprovalPack, type ApprovalContext, type ApprovalPack } from './pack'
import { ApprovalDetailsSchema, emptyDetails, type ApprovalDetails } from './schemas'
import { SOURCES, type LegalSource } from './sources'
import { loadAnnexe } from '@/lib/annexe/get-annexe.service'
import { annexeTitle } from '@/lib/annexe/annexe-document'
import type { GroupAccess } from '@/lib/management-fees/access'

const day = (value: Date) => calendarDayOf(value) as string

interface YearRow {
  id: string
  year: number
  startDate: Date
  endDate: Date
  isClosed: boolean
}

/**
 * Balances of the year from its validated entries, without its closing
 * entry (journal CL): the result is classes 7 minus 6, and the equity
 * accounts are those before this year's allocation.
 */
async function yearFigures(companyId: string, fy: YearRow) {
  const rows = await loadYearBalances(prisma, companyId, fy.id, { excludeJournalCodes: [CLOSING_JOURNAL.code] })
  const credit = (test: (code: string) => boolean) => rows.filter((r) => test(r.code)).reduce((s, r) => s + r.creditCents - r.debitCents, 0)
  const result = credit((c) => c.startsWith('6') || c.startsWith('7'))
  const balances: AllocationBalances = {
    resultCents: result,
    legalReserveCents: Math.max(0, credit((c) => c.startsWith('1061'))),
    capitalCents: Math.max(0, credit((c) => c.startsWith('101'))),
    retainedEarningsCents: Math.max(0, credit((c) => c.startsWith('110'))),
    priorLossesCents: Math.max(0, -credit((c) => c.startsWith('119'))),
  }
  // 120 / 129 carried forward and not allocated yet: the previous year's result.
  const unallocatedPreviousCents = credit((c) => c.startsWith('120') || c.startsWith('129'))
  const revenueCents = credit((c) => c.startsWith('70'))
  const sheet = await generateBalanceSheet(companyId, fy.id, 'complete')
  return { balances, unallocatedPreviousCents, revenueCents, totalAssetsCents: toCents(sheet.actifTotal) ?? 0 }
}

/** What the books and the company record say about the approval of `fiscalYearId`. */
export async function loadApprovalContext(companyId: string, fiscalYearId: string, now?: Date): Promise<ApprovalContext & { unallocatedPreviousCents: number }> {
  const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
  const [company, previous, drafts, capital] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        name: true,
        siren: true,
        legalType: true,
        shareCapital: true,
        totalShares: true,
        isHolding: true,
        corporateTaxRegime: true,
        deadlineSettings: true,
        address: { select: { street: true, street2: true, postalCode: true, city: true, country: true } },
        headquartersAddress: { select: { street: true, street2: true, postalCode: true, city: true, country: true } },
      },
    }),
    prisma.fiscalYear.findFirst({
      where: { companyId, endDate: { lt: fiscalYear.startDate } },
      orderBy: { endDate: 'desc' },
      select: { id: true, year: true, startDate: true, endDate: true, isClosed: true },
    }),
    prisma.accountingEntry.count({ where: { companyId, fiscalYearId: fiscalYear.id, status: 'draft' } }),
    getCapitalComposition(companyId, { fiscalYearId: fiscalYear.id }),
  ])
  const current = await yearFigures(companyId, fiscalYear)
  const before = previous ? await yearFigures(companyId, previous) : null
  const address = company.headquartersAddress ?? company.address
  return {
    today: day(todayUtc(now)),
    company: {
      name: company.name,
      siren: company.siren,
      legalType: company.legalType,
      shareCapitalCents: company.shareCapital === null ? null : toCents(company.shareCapital),
      address: address ? formatAddress({ ...address, street2: address.street2 ?? undefined }) : null,
      isHolding: company.isHolding,
      corporateTaxRegime: company.corporateTaxRegime,
      accountsFiledOnline: parseDeadlineSettings(company.deadlineSettings).accountsFiledOnline,
    },
    fiscalYear: { id: fiscalYear.id, year: fiscalYear.year, startDate: day(fiscalYear.startDate), endDate: day(fiscalYear.endDate), isClosed: fiscalYear.isClosed },
    holders: capital.rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, shares: r.shares })),
    totalShares: company.totalShares,
    balances: current.balances,
    figures: {
      revenueCents: current.revenueCents,
      totalAssetsCents: current.totalAssetsCents,
      previous: before ? { revenueCents: before.revenueCents, totalAssetsCents: before.totalAssetsCents } : null,
    },
    draftEntries: drafts,
    unallocatedPreviousCents: current.unallocatedPreviousCents,
  }
}

/** The saved details, read leniently: a stored value that no longer validates starts again from empty. */
export function parseStoredDetails(json: unknown): ApprovalDetails {
  const parsed = ApprovalDetailsSchema.safeParse(json ?? {})
  return parsed.success ? parsed.data : emptyDetails()
}

export interface ApprovalView {
  context: ApprovalContext
  details: ApprovalDetails
  saved: { updatedAt: string } | null
  pack: ApprovalPack
  /** Persons of the company, to pick the officers from (names only). */
  persons: Array<{ id: string; name: string }>
  /** Every source the pack cites, once. */
  sources: LegalSource[]
}

export interface ApprovalOptions {
  /** false: leave the annexe out of the documents (the annexe service reads the size category here). */
  annexe?: boolean
  /** Reads the participations of a holding for the annexe; null leaves them unread. */
  access?: GroupAccess | null
}

/**
 * The annexe as a document of the pack, with what it still misses
 * (lib/annexe): required unless the company is a micro-entreprise
 * (C. com. L123-16-1), filed with the accounts (L232-22, L232-23).
 */
async function annexeDocumentOf(companyId: string, fiscalYearId: string, pack: ApprovalPack, details: ApprovalDetails, access: GroupAccess | null): Promise<ApprovalPack['documents'][number]> {
  const category = pack.size.confirmed ?? pack.size.proposed
  const view = await loadAnnexe(companyId, fiscalYearId, {
    category,
    confirmed: pack.size.confirmed !== null,
    groupMember: details.groupMember ?? null,
    employees: details.size.employees,
    access,
  })
  const micro = view.annexe.list === 'micro'
  return {
    id: 'annexe',
    title: annexeTitle(view.annexe),
    required: !micro,
    reason: micro
      ? "Une micro-entreprise peut ne pas établir d'annexe ; elle mentionne à la suite du bilan ses engagements et les avances à ses dirigeants (page Annexe)."
      : `Partie des comptes annuels, déposée avec eux : ${view.annexe.listLabel.toLowerCase()} (page Annexe).`,
    sources: micro ? [SOURCES.L123_16_1] : [SOURCES.L123_16],
    missing: view.annexe.missing.map((m) => m.label),
  }
}

export async function getApproval(companyId: string, fiscalYearId: string, now?: Date, options: ApprovalOptions = {}): Promise<ApprovalView> {
  const context = await loadApprovalContext(companyId, fiscalYearId, now)
  const [row, persons] = await Promise.all([
    prisma.accountsApproval.findUnique({
      where: { fiscalYearId_companyId: { fiscalYearId: context.fiscalYear.id, companyId } },
      select: { details: true, updatedAt: true },
    }),
    prisma.person.findMany({
      where: { companyId },
      orderBy: [{ name: 'asc' }, { firstName: 'asc' }],
      take: 200,
      select: { id: true, firstName: true, name: true, usualName: true },
    }),
  ])
  const details = parseStoredDetails(row?.details)
  const pack = buildApprovalPack(context, details)
  if (options.annexe !== false && pack.regime) {
    const annexe = await annexeDocumentOf(companyId, context.fiscalYear.id, pack, details, options.access ?? null)
    const at = pack.documents.findIndex((d) => d.id === 'filing-checklist')
    pack.documents.splice(at < 0 ? pack.documents.length : at, 0, annexe)
  }
  if (context.unallocatedPreviousCents !== 0) {
    pack.warnings.unshift(
      "Le résultat de l'exercice précédent n'est pas encore affecté (comptes 120 ou 129 reportés à nouveau) : affectez-le d'abord depuis la page Exercices, les réserves et le report à nouveau en dépendent.",
    )
  }
  const plainContext: ApprovalContext = {
    today: context.today,
    company: context.company,
    fiscalYear: context.fiscalYear,
    holders: context.holders,
    totalShares: context.totalShares,
    balances: context.balances,
    figures: context.figures,
    draftEntries: context.draftEntries,
  }
  const seen = new Set<string>()
  const sources = [...pack.deadlines.sources, ...pack.managementReport.sources, ...pack.documents.flatMap((d) => d.sources)].filter((s) => {
    if (seen.has(s.label)) return false
    seen.add(s.label)
    return true
  })
  return {
    context: plainContext,
    details,
    saved: row ? { updatedAt: row.updatedAt.toISOString() } : null,
    pack,
    persons: persons.map((p) => ({ id: p.id, name: `${p.firstName} ${p.usualName || p.name}`.trim() })),
    sources,
  }
}
