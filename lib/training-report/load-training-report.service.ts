/**
 * The bilan pédagogique et financier of a closed fiscal year
 * (docs/organisme-de-formation.md): frame C from the books and the origins
 * the user assigned, frame D from the books unless entered, the frames
 * entered by hand, the consistency checks of the notice, the deadline.
 * The last closed fiscal year by default (R6352-22: "au cours de l'exercice
 * comptable"; the form: "dernier exercice comptable clos").
 *
 * Every query is scoped by the company the caller resolved.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { isTrainingOrganisation } from '@/lib/companies/nav-features'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { loadAccountSettings } from '@/lib/vat-deduction/coefficient'
import { assignRevenue, frameC, frameD, pedagogicalTotals, trainingReportChecks, type AssignedRevenue, type FrameC, type FrameD, type PedagogicalTotals, type RevenueByTiersRow } from './compute'
import { isTrainingOrigin, type TrainingOrigin } from './origins'
import { parseTrainingReportData, type TrainingReportData } from './schemas'
import { TRAINING_REPORT_SOURCES, type TrainingReportSource } from './sources'
import { bpfDeadlineOf } from './deadline'

export const TrainingReportQuerySchema = z.object({
  fiscalYearId: z.string().max(64).optional(),
})
export type TrainingReportQuery = z.infer<typeof TrainingReportQuerySchema>

/** Customers listed at most for the assignment of origins. */
const MAX_TIERS = 2_000

export interface TrainingReportView {
  today: string
  trainingOrganisation: boolean
  establishments: Array<{ id: string; name: string | null; siret: string; declarationNumber: string | null }>
  fiscalYears: Array<{ id: string; year: number; startDate: string; endDate: string; isClosed: boolean }>
  fiscalYear: { id: string; year: number; startDate: string; endDate: string; isClosed: boolean } | null
  deadline: { date: string; extendedDate: string | null } | null
  revenue: AssignedRevenue[]
  turnoverCents: number
  frameC: FrameC | null
  frameD: FrameD | null
  data: TrainingReportData
  totals: PedagogicalTotals
  checks: string[]
  /** Customers with revenue in the year and their origin, for the assignment. */
  customers: Array<{ id: string; name: string; auxiliaryAccountNumber: string; trainingOrigin: TrainingOrigin | null; cents: number }>
  accountOrigins: Array<{ accountCode: string; trainingOrigin: TrainingOrigin }>
  sources: TrainingReportSource[]
}

const day = (value: Date) => calendarDayOf(value) as string

/** Revenue (70 and 74) of a fiscal year by account and by the one customer of each entry. */
async function revenueByTiers(companyId: string, fiscalYearId: string): Promise<RevenueByTiersRow[]> {
  const rows = await prisma.$queryRaw<Array<{ code: string; label: string; aux: string | null; cents: bigint }>>`
    WITH customers AS (
      SELECT l2."accountingEntryId" AS id, CASE WHEN count(DISTINCT l2."auxiliaryAccountNumber") = 1 THEN min(l2."auxiliaryAccountNumber") END AS aux
      FROM "entry_lines" l2
      JOIN "accounting_entries" e2 ON e2."id" = l2."accountingEntryId"
      JOIN "accounts" a2 ON a2."id" = l2."accountId"
      WHERE e2."companyId" = ${companyId} AND e2."fiscalYearId" = ${fiscalYearId} AND e2."status" = 'validated'
        AND a2."code" LIKE '41%' AND l2."auxiliaryAccountNumber" IS NOT NULL
      GROUP BY l2."accountingEntryId"
    )
    SELECT a."code" AS code, max(a."label") AS label, c."aux" AS aux, round(sum(l."credit" - l."debit") * 100)::bigint AS cents
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "journals" j ON j."id" = e."journalId"
    JOIN "accounts" a ON a."id" = l."accountId"
    LEFT JOIN customers c ON c."id" = e."id"
    WHERE e."companyId" = ${companyId} AND e."fiscalYearId" = ${fiscalYearId} AND e."status" = 'validated'
      AND (a."code" LIKE '70%' OR a."code" LIKE '74%') AND j."code" NOT IN ('AN', 'CL') AND coalesce(e."reference", '') NOT LIKE 'CL-%'
    GROUP BY a."code", c."aux"
    HAVING sum(l."credit" - l."debit") <> 0
    ORDER BY a."code", c."aux"
  `
  return rows.map((r) => ({ code: r.code, label: r.label, auxiliary: r.aux, cents: Number(r.cents) }))
}

/** Charges of the fiscal year from the books: class 6 without 69, 6411, 604 and 6226 (notice of frame D). */
async function chargesOf(companyId: string, fiscalYearId: string) {
  const [row] = await prisma.$queryRaw<Array<{ total: bigint | null; salaries: bigint | null; purchases: bigint | null }>>`
    SELECT
      round(sum(CASE WHEN a."code" LIKE '6%' AND a."code" NOT LIKE '69%' THEN l."debit" - l."credit" ELSE 0 END) * 100)::bigint AS total,
      round(sum(CASE WHEN a."code" LIKE '6411%' THEN l."debit" - l."credit" ELSE 0 END) * 100)::bigint AS salaries,
      round(sum(CASE WHEN a."code" LIKE '604%' OR a."code" LIKE '6226%' THEN l."debit" - l."credit" ELSE 0 END) * 100)::bigint AS purchases
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "journals" j ON j."id" = e."journalId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."companyId" = ${companyId} AND e."fiscalYearId" = ${fiscalYearId} AND e."status" = 'validated'
      AND a."code" LIKE '6%' AND j."code" NOT IN ('AN', 'CL') AND coalesce(e."reference", '') NOT LIKE 'CL-%'
  `
  return { totalCents: Number(row?.total ?? 0), trainerSalariesCents: Number(row?.salaries ?? 0), trainingPurchasesCents: Number(row?.purchases ?? 0) }
}

export async function loadTrainingReport(companyId: string, query: TrainingReportQuery, options: { now?: Date } = {}): Promise<TrainingReportView> {
  const today = day(todayUtc(options.now))
  const [years, establishments, training] = await Promise.all([
    prisma.fiscalYear.findMany({ where: { companyId }, orderBy: { startDate: 'desc' }, select: { id: true, year: true, startDate: true, endDate: true, isClosed: true }, take: 100 }),
    prisma.establishment.findMany({ where: { companyId, isTrainingOrganization: true }, select: { id: true, name: true, siret: true, trainingActivityDeclarationNumber: true }, take: 50 }),
    isTrainingOrganisation(companyId),
  ])
  const fiscalYears = years.map((fy) => ({ id: fy.id, year: fy.year, startDate: day(fy.startDate), endDate: day(fy.endDate), isClosed: fy.isClosed }))
  if (query.fiscalYearId && !fiscalYears.some((fy) => fy.id === query.fiscalYearId)) throw new NotFoundError('Exercice introuvable')
  const fiscalYear =
    fiscalYears.find((fy) => fy.id === query.fiscalYearId) ??
    fiscalYears.find((fy) => fy.endDate < today) ??
    fiscalYears[0] ??
    null

  const base = {
    today,
    trainingOrganisation: training,
    establishments: establishments.map((e) => ({ id: e.id, name: e.name, siret: e.siret, declarationNumber: e.trainingActivityDeclarationNumber })),
    fiscalYears,
    fiscalYear,
    sources: Object.values(TRAINING_REPORT_SOURCES),
  }
  if (!fiscalYear) {
    const data = parseTrainingReportData({})
    return { ...base, deadline: null, revenue: [], turnoverCents: 0, frameC: null, frameD: null, data, totals: pedagogicalTotals(data), checks: [], customers: [], accountOrigins: [] }
  }

  const [rows, charges, report, settings] = await Promise.all([
    revenueByTiers(companyId, fiscalYear.id),
    chargesOf(companyId, fiscalYear.id),
    prisma.trainingReport.findUnique({ where: { companyId_fiscalYearId: { companyId, fiscalYearId: fiscalYear.id } }, select: { data: true } }),
    loadAccountSettings(companyId),
  ])
  const auxiliaries = [...new Set(rows.map((r) => r.auxiliary).filter((a): a is string => a !== null))]
  const tiers = auxiliaries.length
    ? await prisma.tiers.findMany({
        where: { companyId, auxiliaryAccountNumber: { in: auxiliaries } },
        select: { id: true, name: true, auxiliaryAccountNumber: true, trainingOrigin: true },
        take: MAX_TIERS,
      })
    : []
  const tiersInputs = tiers.map((t) => ({ ...t, trainingOrigin: isTrainingOrigin(t.trainingOrigin) ? t.trainingOrigin : null }))
  const accountOrigins = settings.flatMap((s) => (isTrainingOrigin(s.trainingOrigin) ? [{ accountCode: s.accountCode, trainingOrigin: s.trainingOrigin }] : []))
  const revenue = assignRevenue(rows, { tiers: tiersInputs, accounts: accountOrigins })
  const turnoverCents = rows.filter((r) => r.code.startsWith('70')).reduce((s, r) => s + r.cents, 0)
  const c = frameC(revenue, turnoverCents)
  const data = parseTrainingReportData(report?.data)
  const customers = tiersInputs
    .map((t) => ({ ...t, cents: rows.filter((r) => r.auxiliary === t.auxiliaryAccountNumber).reduce((s, r) => s + r.cents, 0) }))
    .sort((a, b) => b.cents - a.cents)
  const unassignedTiers = new Set(revenue.filter((r) => r.source === 'unassigned' && r.tiers).map((r) => r.tiers!.id)).size

  return {
    ...base,
    deadline: bpfDeadlineOf(fiscalYear.endDate),
    revenue,
    turnoverCents,
    frameC: c,
    frameD: frameD(charges, data.charges),
    data,
    totals: pedagogicalTotals(data),
    checks: trainingReportChecks(data, c, unassignedTiers),
    customers,
    accountOrigins,
  }
}
