/**
 * Statuses of the deadlines of a company (docs/echeances.md, tracker):
 * loads what the user recorded (declaration_statuses) and the facts other
 * modules hold (VAT filing records, corporate tax returns, approvals of the
 * accounts, CFE avis), then derives each status with the pure rule of
 * status.ts. Every query is scoped by the company the caller resolved; the
 * deadlines come from the engine for that company.
 */

import { prisma } from '@/lib/prisma'
import { acomptesNotDue, type FiledReference } from '@/lib/corporate-tax/acomptes'
import { durationOf } from '@/lib/corporate-tax/rules'
import { firstExerciceOfCompany, liasseLegalDate } from '@/lib/deadlines/engine'
import type { CompanyContext } from '@/lib/deadlines/load-deadlines.service'
import type { Deadline } from '@/lib/deadlines/types'
import { addIsoDays, calendarDayOf } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import { sourceFactsOf, type CorporateTaxFact, type SourceData } from './sources'
import { deriveStatus, type TrackedDeadline, type TrackerRecord } from './status'

const day = (value: Date) => calendarDayOf(value) as string
const cents = (value: { toString(): string } | null) => (value === null ? null : parseCents(value.toString()))

const VAT_RULES = new Set(['tva-ca3', 'tva-ca12'])
const keyOf = (id: string) => id.slice(id.indexOf(':') + 1)

/** At most this many deadlines are read at once (a calendar of a few years holds a few hundred). */
export const MAX_TRACKED_DEADLINES = 2_000

/**
 * The acomptes paid of a corporate tax row ({ number, paidOn, amountCents },
 * validated by AcomptePaidSchema when saved), the malformed entries left out.
 * Read here without importing the corporate tax module, which reads the
 * deadline calendar that reads this one.
 */
function acomptesOf(json: unknown): CorporateTaxFact['acomptesPaid'] {
  if (!Array.isArray(json)) return []
  return json.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return []
    const { number, paidOn, amountCents } = item as Record<string, unknown>
    return Number.isInteger(number) && typeof paidOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(paidOn) && Number.isInteger(amountCents)
      ? [{ number: number as number, paidOn, amountCents: amountCents as number }]
      : []
  })
}

type FiledRow = { filedOn: Date | null; resultBeforeDeficits: { toString(): string } | null; deficitsImputed: { toString(): string } | null; corporateTax: { toString(): string } | null; reducedRate: boolean | null }
type TrackedFiscalYear = CompanyContext['fiscalYears'][number]

/** The figures of a filed return (all recorded with the filing, lib/corporate-tax), the reference of acomptes; null before the filing. */
function filedReferenceOf(row: FiledRow | undefined, fy: TrackedFiscalYear): FiledReference | null {
  if (!row?.filedOn || row.resultBeforeDeficits === null || row.deficitsImputed === null || row.corporateTax === null || row.reducedRate === null) return null
  return {
    profitCents: Math.max((cents(row.resultBeforeDeficits) ?? 0) - (cents(row.deficitsImputed) ?? 0), 0),
    duration: durationOf(fy.startDate, fy.endDate),
    reducedRate: row.reducedRate,
  }
}

/**
 * The acomptes of a fiscal year known not to be due (acomptesNotDue): the
 * reference is the exercice before it, as filed, and the one before that
 * for a first acompte falling before the previous return is due. An
 * exercice absent from Kledg is an unknown reference, never a zero.
 */
function acomptesNotDueOf(context: CompanyContext, fy: TrackedFiscalYear, rows: ReadonlyMap<string, FiledRow>, deadlines: readonly Deadline[]): number[] {
  const dues = deadlines
    .filter((d) => d.ruleId === 'is-acompte' && d.id.startsWith(`is-acompte:${fy.endDate}:`))
    .map((d) => ({ number: Number(d.id.split(':')[2]), legalDate: d.legalDate }))
  if (dues.length === 0) return []
  const years = context.fiscalYears
  const previousFy = years.find((y) => addIsoDays(y.endDate, 1) === fy.startDate) ?? null
  const beforePreviousFy = previousFy ? (years.find((y) => addIsoDays(y.endDate, 1) === previousFy.startDate) ?? null) : null
  const previousIsFirst = previousFy !== null && years[0]?.id === previousFy.id && firstExerciceOfCompany(context.company.foundationDate, previousFy)
  return acomptesNotDue({
    dues,
    previous: previousFy ? filedReferenceOf(rows.get(previousFy.id), previousFy) : null,
    beforePrevious: beforePreviousFy ? filedReferenceOf(rows.get(beforePreviousFy.id), beforePreviousFy) : previousIsFirst ? 'none' : null,
    previousReturnDue: liasseLegalDate(addIsoDays(fy.startDate, -1)),
  })
}

/** The facts of the other modules for these deadlines. */
export async function loadSourceData(companyId: string, context: CompanyContext, deadlines: readonly Deadline[]): Promise<SourceData> {
  const periodKeys = [...new Set(deadlines.filter((d) => VAT_RULES.has(d.ruleId)).map((d) => keyOf(d.id)))]
  const [vat, returns] = await Promise.all([
    periodKeys.length
      ? prisma.vatReturnFiling.findMany({ where: { companyId, periodKey: { in: periodKeys } }, select: { periodKey: true, filedOn: true, amountDue: true }, take: MAX_TRACKED_DEADLINES })
      : Promise.resolve([]),
    prisma.corporateTaxReturn.findMany({
      where: { companyId },
      select: { fiscalYearId: true, filedOn: true, acomptesPaid: true, resultBeforeDeficits: true, deficitsImputed: true, corporateTax: true, reducedRate: true },
      take: 200,
    }),
  ])
  const rowOf = new Map(returns.map((row) => [row.fiscalYearId, row]))
  const corporateTax = new Map<string, CorporateTaxFact>()
  // Every fiscal year in Kledg: its liasse and acomptes are recorded on the IS page, with or without a row yet.
  for (const fy of context.fiscalYears) {
    const row = rowOf.get(fy.id)
    corporateTax.set(fy.endDate, {
      fiscalYearId: fy.id,
      filedOn: row?.filedOn ? day(row.filedOn) : null,
      acomptesPaid: acomptesOf(row?.acomptesPaid),
      acomptesNotDue: acomptesNotDueOf(context, fy, rowOf, deadlines),
    })
  }
  const approvals = new Map(
    context.fiscalYears.map((fy) => [fy.endDate, { fiscalYearId: fy.id, approvedOn: context.approvals[fy.id]?.approvedOn ?? null, filedOn: context.approvals[fy.id]?.filedOn ?? null }]),
  )
  return {
    vatFilings: new Map(vat.map((v) => [v.periodKey, { filedOn: day(v.filedOn), amountDueCents: cents(v.amountDue) ?? 0 }])),
    corporateTax,
    approvals,
    localTaxes: new Map(context.localTaxes.map((row) => [row.year, { cfeTotalCents: row.cfeTotalCents, cfeAcompteCents: row.cfeAcompteCents }])),
  }
}

/** What the user recorded for these deadline ids, by id. */
export async function loadTrackerRecords(companyId: string, deadlineIds: readonly string[]): Promise<Map<string, TrackerRecord>> {
  if (deadlineIds.length === 0) return new Map()
  const rows = await prisma.declarationStatus.findMany({
    where: { companyId, deadlineId: { in: [...deadlineIds] } },
    select: {
      deadlineId: true,
      filedOn: true,
      paidOn: true,
      amount: true,
      notDue: true,
      attachmentId: true,
      attachmentReference: true,
      note: true,
      updatedAt: true,
      attachment: { select: { fileName: true } },
    },
    take: MAX_TRACKED_DEADLINES,
  })
  return new Map(
    rows.map((r) => [
      r.deadlineId,
      {
        filedOn: r.filedOn ? day(r.filedOn) : null,
        paidOn: r.paidOn ? day(r.paidOn) : null,
        amountCents: cents(r.amount),
        notDue: r.notDue,
        attachmentId: r.attachmentId,
        attachmentName: r.attachment?.fileName ?? null,
        attachmentReference: r.attachmentReference,
        note: r.note,
        updatedAt: r.updatedAt.toISOString(),
      },
    ]),
  )
}

/** The deadlines with their status on `today`, in the same order. */
export async function trackDeadlines(companyId: string, context: CompanyContext, deadlines: readonly Deadline[], today: string): Promise<TrackedDeadline[]> {
  const shown = deadlines.slice(0, MAX_TRACKED_DEADLINES)
  const [data, records] = await Promise.all([loadSourceData(companyId, context, shown), loadTrackerRecords(companyId, shown.map((d) => d.id))])
  return shown.map((d) => ({ ...d, status: deriveStatus(d, sourceFactsOf(d, data), records.get(d.id) ?? null, today) }))
}
