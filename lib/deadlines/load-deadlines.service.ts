/**
 * Loads what the deadline engine needs for one company (regimes, legal form,
 * fiscal years, settings, recorded approvals) in four bounded queries, then runs the pure
 * engine (lib/deadlines/engine.ts). Used by GET /api/deadlines (the
 * Échéances page) and by the "deadlines" source of the dashboard.
 *
 * Every query is scoped by the company the route resolved.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { addIsoDays, calendarDayOf, todayUtc } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import { parsePayrollTaxData } from '@/lib/payroll-tax/schemas'
import { computeDeadlines, missingVatRegime, type DeadlineApproval, type DeadlineCompany, type DeadlineFiscalYear } from './engine'
import { OVERDUE_DAYS } from './relative'
import { RULE_LIST } from './rules'
import { parseDeadlineSettings, type DeadlineSettings } from './settings'
import type { DeadlineRule } from './types'
import { trackDeadlines } from '@/lib/declarations/load-declaration-statuses.service'
import type { TrackedDeadline } from '@/lib/declarations/status'

/** Fiscal years and regime rows read at most (a company has a few dozen in a lifetime). */
const MAX_FISCAL_YEARS = 100
const MAX_LOCAL_TAX_YEARS = 100
const MAX_REGIME_ROWS = 200

/** The widget looks this far ahead... */
export const WIDGET_HORIZON_DAYS = 60
/** ...and keeps deadlines missed this recently, shown as late. */
export const WIDGET_OVERDUE_DAYS = OVERDUE_DAYS

const day = (value: Date) => calendarDayOf(value) as string

/** The "filed online" answer of an approval (lib/approval/schemas.ts), null when not given. */
function filedOnlineOf(details: unknown): boolean | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const value = (details as Record<string, unknown>).filedOnline
  return typeof value === 'boolean' ? value : null
}

export interface CompanyContext {
  company: DeadlineCompany
  fiscalYears: Array<DeadlineFiscalYear & { year: number; isClosed: boolean }>
  settings: DeadlineSettings
  /** Approval and filing days recorded in the approval pack (lib/approval), by fiscal year id. */
  approvals: Record<string, DeadlineApproval>
  /** CFE avis entered on the local taxes page (lib/local-taxes), by calendar year. */
  localTaxes: Array<{ year: number; cfeTotalCents: number | null; cfeAcompteCents: number | null }>
  /** Total CFE by year, for the acompte rule of the engine (CGI art. 1679 quinquies). */
  cfeAmounts: Record<number, number>
  /** An establishment is an organisme de formation (bilan pédagogique et financier). */
  trainingOrganisation: boolean
  /** Taxe sur les salaires as last saved, by calendar year (lib/payroll-tax). */
  payrollTax: Record<number, { liable: boolean; frequency: 'monthly' | 'quarterly' | 'annual' }>
}

/** What the engine needs for one company; also read by the VAT return worksheet (lib/vat-returns). */
export async function loadDeadlineContext(companyId: string): Promise<CompanyContext> {
  const [company, fiscalYears, history, approvals, localTaxes, trainingEstablishments, payrollRows] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { legalType: true, vatRegime: true, isVatExempt: true, corporateTaxRegime: true, foundationDate: true, deadlineSettings: true },
    }),
    prisma.fiscalYear.findMany({
      where: { companyId },
      orderBy: { startDate: 'asc' },
      take: MAX_FISCAL_YEARS,
      select: { id: true, year: true, startDate: true, endDate: true, isClosed: true },
    }),
    prisma.taxRegimeHistory.findMany({
      where: { companyId },
      orderBy: { startDate: 'asc' },
      take: MAX_REGIME_ROWS,
      select: { regimeType: true, regime: true, startDate: true, endDate: true, isVatExempt: true, establishmentId: true },
    }),
    prisma.accountsApproval.findMany({
      where: { companyId },
      take: MAX_FISCAL_YEARS,
      select: { fiscalYearId: true, approvedOn: true, filedOn: true, details: true },
    }),
    prisma.localTaxYear.findMany({
      where: { companyId },
      orderBy: { year: 'asc' },
      take: MAX_LOCAL_TAX_YEARS,
      select: { year: true, cfeTotal: true, cfeAcompte: true },
    }),
    prisma.establishment.count({ where: { companyId, isTrainingOrganization: true } }),
    prisma.payrollTaxYear.findMany({ where: { companyId }, orderBy: { year: 'asc' }, take: MAX_LOCAL_TAX_YEARS, select: { year: true, data: true } }),
  ])
  if (!company) throw new NotFoundError('Société non trouvée')
  const turnover = await prisma.$queryRaw<Array<{ year: number; cents: bigint }>>`
    SELECT extract(year FROM e."date")::int AS year, round(sum(l."credit" - l."debit") * 100)::bigint AS cents
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."companyId" = ${companyId} AND e."status" = 'validated' AND a."code" LIKE '70%'
    GROUP BY 1
  `
  // Loi n° 2025-127, art. 38, 5° a (CGI art. 287, 3 from 2027): the thresholds compare "le chiffre d'affaires
  // majoré des acquisitions taxables", the turnover plus the operations for which the company is liable under
  // CGI art. 283, 2 to 2 decies. Read here: the services self-assessed on 4452 (a service counterpart, as the
  // VAT return reads them, classify.ts), not the purchases of art. 283, 1 (44528). Whether the
  // intra-Community acquisitions of goods count was not confirmed in the text: left out.
  const selfAssessed = await prisma.$queryRaw<Array<{ year: number; cents: bigint }>>`
    SELECT extract(year FROM e."date")::int AS year, round(sum(l."debit" - l."credit") * 100)::bigint AS cents
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."companyId" = ${companyId} AND e."status" = 'validated'
      AND a."code" LIKE '6%' AND (a."code" NOT LIKE '60%' OR a."code" LIKE '604%')
      AND EXISTS (
        SELECT 1 FROM "entry_lines" v JOIN "accounts" va ON va."id" = v."accountId"
        WHERE v."accountingEntryId" = e."id" AND va."code" LIKE '4452%' AND va."code" NOT LIKE '44528%' AND v."credit" > 0
      )
    GROUP BY 1
  `
  const thresholdCents = new Map<number, number>()
  for (const row of [...turnover, ...selfAssessed]) thresholdCents.set(row.year, (thresholdCents.get(row.year) ?? 0) + Number(row.cents))
  const local = localTaxes.map((row) => ({ year: row.year, cfeTotalCents: row.cfeTotal === null ? null : parseCents(row.cfeTotal), cfeAcompteCents: row.cfeAcompte === null ? null : parseCents(row.cfeAcompte) }))
  return {
    company: {
      legalType: company.legalType,
      vatRegime: company.vatRegime,
      isVatExempt: company.isVatExempt,
      corporateTaxRegime: company.corporateTaxRegime,
      foundationDate: company.foundationDate ? day(company.foundationDate) : null,
      regimeHistory: history.map((r) => ({
        regimeType: r.regimeType,
        regime: r.regime,
        startDate: day(r.startDate),
        endDate: r.endDate ? day(r.endDate) : null,
        isVatExempt: r.isVatExempt,
        establishmentId: r.establishmentId,
      })),
      // Chiffre d'affaires majoré des acquisitions taxables per calendar year: the threshold of the quarterly CA3 from 2027
      turnoverCentsByYear: Object.fromEntries(thresholdCents),
    },
    fiscalYears: fiscalYears.map((fy) => ({ id: fy.id, year: fy.year, startDate: day(fy.startDate), endDate: day(fy.endDate), isClosed: fy.isClosed })),
    settings: parseDeadlineSettings(company.deadlineSettings),
    approvals: Object.fromEntries(
      approvals.map((a) => [
        a.fiscalYearId,
        { approvedOn: a.approvedOn ? day(a.approvedOn) : null, filedOn: a.filedOn ? day(a.filedOn) : null, filedOnline: filedOnlineOf(a.details) },
      ]),
    ),
    localTaxes: local,
    cfeAmounts: Object.fromEntries(local.filter((row) => row.cfeTotalCents !== null).map((row) => [row.year, row.cfeTotalCents as number])),
    trainingOrganisation: trainingEstablishments > 0,
    payrollTax: Object.fromEntries(
      payrollRows.flatMap((row) => {
        const computed = parsePayrollTaxData(row.data).computed
        return computed ? [[row.year, { liable: computed.liable, frequency: computed.frequency }]] : []
      }),
    ),
  }
}

// ---------------------------------------------------------------- widget

export interface DeadlinesWidgetData {
  today: string
  horizonDays: number
  overdueDays: number
  /** From WIDGET_OVERDUE_DAYS ago to WIDGET_HORIZON_DAYS ahead, in date order, with their status (docs/echeances.md). */
  deadlines: TrackedDeadline[]
  /** No VAT regime is known: the VAT deadlines cannot be listed. */
  missingRegimes: boolean
}

export async function loadDeadlinesWidget(companyId: string, now?: Date): Promise<DeadlinesWidgetData> {
  const context = await loadDeadlineContext(companyId)
  const today = day(todayUtc(now))
  const computed = computeDeadlines({
    ...context,
    from: addIsoDays(today, -WIDGET_OVERDUE_DAYS),
    to: addIsoDays(today, WIDGET_HORIZON_DAYS),
  })
  const deadlines = await trackDeadlines(companyId, context, computed, today)
  return {
    today,
    horizonDays: WIDGET_HORIZON_DAYS,
    overdueDays: WIDGET_OVERDUE_DAYS,
    deadlines,
    missingRegimes: missingVatRegime(context.company),
  }
}

// ---------------------------------------------------------------- page

/** ?companyId=&fiscalYearId= ; a fiscal year of another company falls back to the current one. */
export const DeadlinesQuerySchema = z.object({
  fiscalYearId: z.string().max(64).optional(),
})
export type DeadlinesQuery = z.infer<typeof DeadlinesQuerySchema>

export interface DeadlinesView {
  today: string
  fiscalYear: { id: string; year: number; startDate: string; endDate: string; isClosed: boolean } | null
  /** Deadlines dated within the fiscal year, in date order, with their status (filed, paid, late...). */
  deadlines: TrackedDeadline[]
  /** The rules the deadlines come from, with their official sources. */
  rules: DeadlineRule[]
  settings: DeadlineSettings
  missingRegimes: boolean
}

export async function loadDeadlinesView(companyId: string, query: DeadlinesQuery, now?: Date): Promise<DeadlinesView> {
  const context = await loadDeadlineContext(companyId)
  const today = day(todayUtc(now))
  const years = context.fiscalYears
  const fiscalYear =
    (query.fiscalYearId ? years.find((fy) => fy.id === query.fiscalYearId) : undefined) ??
    years.find((fy) => fy.startDate <= today && fy.endDate >= today) ??
    years[years.length - 1] ??
    null
  const deadlines = fiscalYear ? await trackDeadlines(companyId, context, computeDeadlines({ ...context, from: fiscalYear.startDate, to: fiscalYear.endDate }), today) : []
  const usedRules = new Set(deadlines.map((d) => d.ruleId))
  return {
    today,
    fiscalYear,
    deadlines,
    rules: RULE_LIST.filter((r) => usedRules.has(r.id)),
    settings: context.settings,
    missingRegimes: missingVatRegime(context.company),
  }
}
