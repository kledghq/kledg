/**
 * Statuses of the deadlines of a company (docs/echeances.md, tracker):
 * loads what the user recorded (declaration_statuses) and the facts other
 * modules hold (VAT filing records, corporate tax returns, approvals of the
 * accounts, CFE avis), then derives each status with the pure rule of
 * status.ts. Every query is scoped by the company the caller resolved; the
 * deadlines come from the engine for that company.
 */

import { prisma } from '@/lib/prisma'
import type { CompanyContext } from '@/lib/deadlines/load-deadlines.service'
import type { Deadline } from '@/lib/deadlines/types'
import { calendarDayOf } from '@/lib/utils/date'
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

/** The facts of the other modules for these deadlines. */
export async function loadSourceData(companyId: string, context: CompanyContext, deadlines: readonly Deadline[]): Promise<SourceData> {
  const periodKeys = [...new Set(deadlines.filter((d) => VAT_RULES.has(d.ruleId)).map((d) => keyOf(d.id)))]
  const [vat, returns] = await Promise.all([
    periodKeys.length
      ? prisma.vatReturnFiling.findMany({ where: { companyId, periodKey: { in: periodKeys } }, select: { periodKey: true, filedOn: true, amountDue: true }, take: MAX_TRACKED_DEADLINES })
      : Promise.resolve([]),
    prisma.corporateTaxReturn.findMany({ where: { companyId }, select: { fiscalYearId: true, filedOn: true, acomptesPaid: true }, take: 200 }),
  ])
  const endOf = new Map(context.fiscalYears.map((fy) => [fy.id, fy.endDate]))
  const corporateTax = new Map<string, CorporateTaxFact>()
  // Every fiscal year in Kledg: its liasse and acomptes are recorded on the IS page, with or without a row yet.
  for (const fy of context.fiscalYears) corporateTax.set(fy.endDate, { fiscalYearId: fy.id, filedOn: null, acomptesPaid: [] })
  for (const row of returns) {
    const end = endOf.get(row.fiscalYearId)
    if (end) corporateTax.set(end, { fiscalYearId: row.fiscalYearId, filedOn: row.filedOn ? day(row.filedOn) : null, acomptesPaid: acomptesOf(row.acomptesPaid) })
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
