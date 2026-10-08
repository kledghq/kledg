/**
 * Query strings of the report routes (app/api/reports/**, app/api/fec,
 * app/api/companies/[id]/balance-sheet/** and income-statement/**), parsed
 * by the route wrappers' `query` option with French messages, and the check
 * that the fiscal years they name belong to the company.
 *
 * Dates are calendar days (yyyy-mm-dd, or a stored date as an ISO
 * timestamp) read at midnight UTC, never through the server timezone.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { parseCalendarDay } from './ledger/query'

export const FISCAL_YEAR_NOT_FOUND = 'Exercice fiscal introuvable'

const required = (name: string) => z.string({ error: `${name} est requis : choisissez l'exercice` })

/** A calendar day parameter: undefined when absent, a 400 naming the field when invalid. */
const calendarDay = (label: string) =>
  z
    .string()
    .optional()
    .transform((value) => parseCalendarDay(value ?? null, label))

export const ReportVariantSchema = z
  .enum(['complete', 'simplified'], { error: 'Variante inconnue : complete ou simplified' })
  .default('complete')
export type ReportVariant = z.infer<typeof ReportVariantSchema>

/** ?variant= (layout routes). */
export const VariantQuerySchema = z.object({ variant: ReportVariantSchema })

/** ?fiscalYearId=&variant= (balance sheet, income statement, their exports). */
export const StatementQuerySchema = z.object({
  fiscalYearId: required('fiscalYearId'),
  variant: ReportVariantSchema,
})

/** ?fiscalYearId=&previousFiscalYearId=&variant= (balance sheet export, with the N-1 column when given). */
export const StatementExportQuerySchema = StatementQuerySchema.extend({ previousFiscalYearId: z.string().optional() })

/** ?currentFiscalYearId=&previousFiscalYearId=&variant= (balance sheet N / N-1). */
export const ComparisonQuerySchema = z.object({
  currentFiscalYearId: required('currentFiscalYearId'),
  previousFiscalYearId: required('previousFiscalYearId'),
  variant: ReportVariantSchema,
})

/** ?fiscalYearId= (optional: the latest or the current fiscal year by default). */
export const OptionalFiscalYearQuerySchema = z.object({ fiscalYearId: z.string().optional() })

/** ?fiscalYearId= | &startDate=&endDate= (trial balance, general ledger). */
export const LedgerPeriodQuerySchema = z.object({
  fiscalYearId: z.string().optional(),
  startDate: calendarDay('Date de début'),
  endDate: calendarDay('Date de fin'),
})

/** ?journalId=&startDate=&endDate= (journal report): all journals when journalId is absent or "all". */
export const JournalReportQuerySchema = z.object({
  journalId: z.string().optional(),
  startDate: calendarDay('Date de début'),
  endDate: calendarDay('Date de fin'),
})

/** ?fiscalYearId=&report=1 (FEC file, or its compliance report). */
export const FecQuerySchema = z.object({
  fiscalYearId: z.string().optional(),
  report: z.string().optional().transform((value) => value === '1'),
})

/** Throws a 404 unless every given fiscal year belongs to the company. */
export async function assertFiscalYearsOwned(companyId: string, ...fiscalYearIds: Array<string | null | undefined>): Promise<void> {
  const ids = [...new Set(fiscalYearIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  if (ids.length === 0) return
  const count = await prisma.fiscalYear.count({ where: { id: { in: ids }, companyId } })
  if (count !== ids.length) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
}
