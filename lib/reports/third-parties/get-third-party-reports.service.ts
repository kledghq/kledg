/**
 * Aged balance and auxiliary balance of a company (lib/reports/third-parties/
 * third-party-balances.ts for the computation), from the validated lines of
 * its customer (411) and supplier (401) accounts in one fiscal year.
 *
 * Accounts belong to one fiscal year, so both reports read one year: lines
 * of earlier years reach it through the opening entry (journal AN), which
 * carries the balance of each account. An opening line without auxiliary
 * account is one tiers named after its account, aged from the first day of
 * the year: detail the opening entry per auxiliary account for exact ages.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { OPENING_JOURNAL } from '@/lib/accounting/fiscal-year-closure/constants'
import { fiscalYearContaining, GUARDED_FISCAL_YEAR_SELECT } from '@/lib/accounting/entry-guards'
import { calendarDay } from '@/lib/api/zod-fields'
import { calendarDayOf, endOfDay, formatIsoDateFr, isoDateToUtc, todayUtc } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import { getPaymentTerms } from '@/lib/companies/payment-terms.service'
import type { PaymentTerms } from './payment-terms'
import {
  buildAgedBalance,
  buildAuxiliaryBalance,
  type AgedSection,
  type AuxiliarySection,
  type ThirdPartyLine,
} from './third-party-balances'

export const FISCAL_YEAR_NOT_FOUND = 'Exercice introuvable pour cette société.'
export const NO_FISCAL_YEAR = "Aucun exercice pour cette société\u00a0: créez d'abord un exercice."

/** ?fiscalYearId=&asOf= (aged balance, its export, the dashboard and the assistants). */
export const AgedBalanceQuerySchema = z.object({
  fiscalYearId: z.string().max(64).optional(),
  asOf: calendarDay('Date de la balance âgée invalide\u00a0: utilisez le format AAAA-MM-JJ').optional(),
})
export type AgedBalanceQuery = z.infer<typeof AgedBalanceQuerySchema>

/** ?fiscalYearId=&startDate=&endDate= (auxiliary balance). */
export const AuxiliaryBalanceQuerySchema = z.object({
  fiscalYearId: z.string().max(64).optional(),
  startDate: calendarDay('Date de début invalide').optional(),
  endDate: calendarDay('Date de fin invalide').optional(),
})
export type AuxiliaryBalanceQuery = z.infer<typeof AuxiliaryBalanceQuerySchema>

interface FiscalYearRef {
  id: string
  year: number
  startDate: string
  endDate: string
  isClosed: boolean
}

async function fiscalYears(companyId: string) {
  return prisma.fiscalYear.findMany({ where: { companyId }, orderBy: { startDate: 'asc' }, select: GUARDED_FISCAL_YEAR_SELECT })
}

type GuardedYear = Awaited<ReturnType<typeof fiscalYears>>[number]

const refOf = (fy: GuardedYear): FiscalYearRef => ({
  id: fy.id,
  year: fy.year,
  startDate: calendarDayOf(fy.startDate) as string,
  endDate: calendarDayOf(fy.endDate) as string,
  isClosed: fy.isClosed,
})

/**
 * The fiscal year of a report: the one named, else the one containing `day`
 * (today by default), else the latest open one, else the latest.
 */
async function resolveFiscalYear(companyId: string, fiscalYearId: string | undefined, day: string): Promise<FiscalYearRef> {
  const years = await fiscalYears(companyId)
  if (fiscalYearId) {
    const named = years.find((fy) => fy.id === fiscalYearId)
    if (!named) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
    return refOf(named)
  }
  const found = fiscalYearContaining(years, day) ?? [...years].reverse().find((fy) => !fy.isClosed) ?? years[years.length - 1]
  if (!found) throw new ValidationError(NO_FISCAL_YEAR)
  return refOf(found)
}

/** Within [start, end] of the year, or a French 400. */
function assertWithinYear(day: string, fy: FiscalYearRef, label: string) {
  if (day < fy.startDate || day > fy.endDate) {
    throw new ValidationError(
      `${label} du ${formatIsoDateFr(day)} est hors de l'exercice ${fy.year} (du ${formatIsoDateFr(fy.startDate)} au ${formatIsoDateFr(fy.endDate)}).`,
    )
  }
}

/** Today within the year: its last day once over, its first day before it starts. */
function defaultDay(fy: FiscalYearRef, now: Date): string {
  const today = calendarDayOf(todayUtc(now)) as string
  if (today < fy.startDate) return fy.startDate
  if (today > fy.endDate) return fy.endDate
  return today
}

/** Validated lines of the 401 and 411 accounts of a fiscal year dated on or before `until`. */
export async function loadThirdPartyLines(companyId: string, fiscalYearId: string, until: string): Promise<ThirdPartyLine[]> {
  const rows = await prisma.entryLine.findMany({
    where: {
      accountFiscalYearId: fiscalYearId,
      account: { OR: [{ code: { startsWith: '401' } }, { code: { startsWith: '411' } }] },
      accountingEntry: { companyId, fiscalYearId, status: 'validated', date: { lte: endOfDay(isoDateToUtc(until)) } },
    },
    select: {
      debit: true,
      credit: true,
      auxiliaryAccountNumber: true,
      auxiliaryAccountLabel: true,
      letteringCode: true,
      letteringDate: true,
      account: { select: { code: true, label: true } },
      accountingEntry: { select: { date: true, journal: { select: { code: true } } } },
    },
  })
  return rows.map((row) => ({
    accountCode: row.account.code,
    accountLabel: row.account.label,
    auxiliaryAccountNumber: row.auxiliaryAccountNumber,
    auxiliaryAccountLabel: row.auxiliaryAccountLabel,
    date: calendarDayOf(row.accountingEntry.date) as string,
    debitCents: parseCents(row.debit) ?? 0,
    creditCents: parseCents(row.credit) ?? 0,
    letteringCode: row.letteringCode,
    letteringDate: calendarDayOf(row.letteringDate),
    opening: row.accountingEntry.journal.code === OPENING_JOURNAL.code,
  }))
}

export interface AgedBalanceReport {
  fiscalYear: FiscalYearRef
  /** Report day, yyyy-mm-dd. */
  asOf: string
  terms: PaymentTerms
  customers: AgedSection
  suppliers: AgedSection
}

/** Aged balance of the company on `asOf` (today within the fiscal year by default). */
export async function getAgedBalance(companyId: string, query: AgedBalanceQuery, now = new Date()): Promise<AgedBalanceReport> {
  const fiscalYear = await resolveFiscalYear(companyId, query.fiscalYearId, query.asOf ?? (calendarDayOf(todayUtc(now)) as string))
  const asOf = query.asOf ?? defaultDay(fiscalYear, now)
  assertWithinYear(asOf, fiscalYear, 'La date')
  const [terms, lines] = await Promise.all([getPaymentTerms(companyId), loadThirdPartyLines(companyId, fiscalYear.id, asOf)])
  return { fiscalYear, asOf, terms, ...buildAgedBalance(lines, asOf, terms) }
}

export interface AuxiliaryBalanceReport {
  fiscalYear: FiscalYearRef
  period: { startDate: string; endDate: string }
  customers: AuxiliarySection
  suppliers: AuxiliarySection
}

/** Auxiliary balance of a period within one fiscal year (the whole year by default). */
export async function getAuxiliaryBalance(companyId: string, query: AuxiliaryBalanceQuery, now = new Date()): Promise<AuxiliaryBalanceReport> {
  const fiscalYear = await resolveFiscalYear(companyId, query.fiscalYearId, query.startDate ?? query.endDate ?? (calendarDayOf(todayUtc(now)) as string))
  const startDate = query.startDate ?? fiscalYear.startDate
  const endDate = query.endDate ?? fiscalYear.endDate
  assertWithinYear(startDate, fiscalYear, 'La date de début')
  assertWithinYear(endDate, fiscalYear, 'La date de fin')
  if (endDate < startDate) throw new ValidationError('La date de fin précède la date de début.')
  const lines = await loadThirdPartyLines(companyId, fiscalYear.id, endDate)
  return { fiscalYear, period: { startDate, endDate }, ...buildAuxiliaryBalance(lines, startDate, endDate) }
}
