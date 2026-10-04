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
import { computeDeadlines, missingVatRegime, type DeadlineApproval, type DeadlineCompany, type DeadlineFiscalYear } from './engine'
import { OVERDUE_DAYS } from './relative'
import { RULE_LIST } from './rules'
import { parseDeadlineSettings, type DeadlineSettings } from './settings'
import type { Deadline, DeadlineRule } from './types'

/** Fiscal years and regime rows read at most (a company has a few dozen in a lifetime). */
const MAX_FISCAL_YEARS = 100
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
}

/** What the engine needs for one company; also read by the VAT return worksheet (lib/vat-returns). */
export async function loadDeadlineContext(companyId: string): Promise<CompanyContext> {
  const [company, fiscalYears, history, approvals] = await Promise.all([
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
  ])
  if (!company) throw new NotFoundError('Société non trouvée')
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
    },
    fiscalYears: fiscalYears.map((fy) => ({ id: fy.id, year: fy.year, startDate: day(fy.startDate), endDate: day(fy.endDate), isClosed: fy.isClosed })),
    settings: parseDeadlineSettings(company.deadlineSettings),
    approvals: Object.fromEntries(
      approvals.map((a) => [
        a.fiscalYearId,
        { approvedOn: a.approvedOn ? day(a.approvedOn) : null, filedOn: a.filedOn ? day(a.filedOn) : null, filedOnline: filedOnlineOf(a.details) },
      ]),
    ),
  }
}

// ---------------------------------------------------------------- widget

export interface DeadlinesWidgetData {
  today: string
  horizonDays: number
  overdueDays: number
  /** From WIDGET_OVERDUE_DAYS ago to WIDGET_HORIZON_DAYS ahead, in date order. */
  deadlines: Deadline[]
  /** No VAT regime is known: the VAT deadlines cannot be listed. */
  missingRegimes: boolean
}

export async function loadDeadlinesWidget(companyId: string, now?: Date): Promise<DeadlinesWidgetData> {
  const context = await loadDeadlineContext(companyId)
  const today = day(todayUtc(now))
  const deadlines = computeDeadlines({
    ...context,
    from: addIsoDays(today, -WIDGET_OVERDUE_DAYS),
    to: addIsoDays(today, WIDGET_HORIZON_DAYS),
  })
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
  /** Deadlines dated within the fiscal year, in date order. */
  deadlines: Deadline[]
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
  const deadlines = fiscalYear ? computeDeadlines({ ...context, from: fiscalYear.startDate, to: fiscalYear.endDate }) : []
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
