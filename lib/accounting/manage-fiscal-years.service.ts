/**
 * Fiscal years of a company: list, read, create (with its PCG chart), change
 * the dates of an open year, and the closing entry points used by the API
 * and the MCP tools. Dates are calendar days stored at midnight UTC
 * (lib/utils/date.ts). A closed fiscal year never changes (PCG art. 1031-3
 * and 1031-4): its dates are refused here, its entries by the database
 * (lib/accounting/fiscal-year-closure/lock.ts).
 *
 * The fiscal years of a company never overlap, closed or not: the entry
 * guards reason per fiscal year, so a second year over the days of a closed
 * one (or of a locked period) would accept entries the closing forbids.
 * Creations and date changes run under one advisory lock per company
 * (`lockCompanyFiscalYears`) and check the overlap inside it.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { closeFiscalYear, simulateFiscalYearClosure } from '@/lib/accounting/fiscal-year-closure'
import { logger } from '@/lib/logger'
import { calendarDayOf, formatIsoDateFr, isoDateToUtc } from '@/lib/utils/date'
import { lockFiscalYearRow } from '@/lib/accounting/fiscal-year-closure/lock'
import { seedPCG } from '@/prisma/seeds/pcg'

export const FISCAL_YEAR_NOT_FOUND = 'Exercice introuvable pour cette société.'

/** A fiscal year of the company (404 for an id of another company). */
export async function ownedFiscalYear(companyId: string, fiscalYearId: string) {
  const fiscalYear = await prisma.fiscalYear.findFirst({
    where: { id: fiscalYearId, companyId },
    select: { id: true, year: true, startDate: true, endDate: true, isClosed: true },
  })
  if (!fiscalYear) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
  return fiscalYear
}

/** Fiscal years of the company, latest first. */
export function listFiscalYears(companyId: string) {
  return prisma.fiscalYear.findMany({ where: { companyId }, orderBy: { year: 'desc' } })
}

/** A fiscal year of the company with all its columns, or a 404. */
export async function getFiscalYear(companyId: string, fiscalYearId: string) {
  const fiscalYear = await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } })
  if (!fiscalYear) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
  return fiscalYear
}

/** The calendar day of a date sent by a client, at midnight UTC, or a French 400. */
function dayOf(value: string, label: string): Date {
  const day = calendarDayOf(value)
  if (!day) throw new ValidationError(`${label} invalide : utilisez le format AAAA-MM-JJ.`)
  return isoDateToUtc(day)
}

function datesOf(input: { startDate: string; endDate: string }): { start: Date; end: Date } {
  const start = dayOf(input.startDate, 'Date de début')
  const end = dayOf(input.endDate, 'Date de fin')
  if (start >= end) throw new ValidationError('La date de début doit précéder la date de fin.')
  return { start, end }
}

export interface CreateFiscalYearInput {
  year: number
  startDate: string
  endDate: string
}

/**
 * Stored days are midnight UTC; rows written by a server in another timezone
 * hold the local midnight, within 12 hours of the day they mean
 * (calendarDayOf). Comparisons keep that margin so such a row reads as its day.
 */
const HALF_DAY_MS = 12 * 60 * 60 * 1000

/**
 * Serializes the creations and date changes of the fiscal years of a
 * company (advisory transaction lock), so two concurrent requests cannot
 * both pass the overlap check.
 */
export async function lockCompanyFiscalYears(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:fiscal-years:${companyId}`}))`
}

/**
 * Refuses (409) dates overlapping any other fiscal year of the company,
 * closed or not. Call it under `lockCompanyFiscalYears`.
 */
export async function assertNoFiscalYearOverlap(
  tx: Prisma.TransactionClient,
  companyId: string,
  dates: { start: Date; end: Date },
  exceptId?: string,
): Promise<void> {
  const overlapping = await tx.fiscalYear.findFirst({
    where: {
      companyId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      startDate: { lt: new Date(dates.end.getTime() + HALF_DAY_MS) },
      endDate: { gt: new Date(dates.start.getTime() - HALF_DAY_MS) },
    },
    orderBy: { startDate: 'asc' },
    select: { year: true, startDate: true, endDate: true, isClosed: true },
  })
  if (overlapping) {
    const state = overlapping.isClosed ? 'clôturé' : 'ouvert'
    throw new ConflictError(
      `Ces dates chevauchent l'exercice ${overlapping.year} (${state}, du ${formatIsoDateFr(calendarDayOf(overlapping.startDate) ?? '')} au ${formatIsoDateFr(calendarDayOf(overlapping.endDate) ?? '')}) : deux exercices ne peuvent pas couvrir le même jour.`,
    )
  }
}

/**
 * Creates a fiscal year with the closing day and month of the company, then
 * seeds its chart with the PCG accounts (optional accounts excluded). The
 * year is usable without the chart: a seeding failure is logged, not thrown.
 * Refused (409) when the year number exists or the dates overlap another
 * fiscal year of the company, closed or not.
 */
export async function createFiscalYear(companyId: string, input: CreateFiscalYearInput) {
  const { start, end } = datesOf(input)
  const fiscalYear = await prisma.$transaction(async (tx) => {
    await lockCompanyFiscalYears(tx, companyId)
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { closingDay: true, closingMonth: true } })
    if (!company) throw new NotFoundError('Société introuvable')

    const existing = await tx.fiscalYear.findUnique({ where: { companyId_year: { companyId, year: input.year } }, select: { id: true } })
    if (existing) throw new ConflictError(`Un exercice pour l'année ${input.year} existe déjà`)
    await assertNoFiscalYearOverlap(tx, companyId, { start, end })

    return tx.fiscalYear.create({
      data: {
        companyId,
        year: input.year,
        closingDay: company.closingDay || 31,
        closingMonth: company.closingMonth || 12,
        startDate: start,
        endDate: end,
      },
    })
  })

  try {
    await seedPCG(companyId, fiscalYear.id, false)
  } catch (error) {
    logger.error('Error seeding PCG for new fiscal year', { error, companyId, fiscalYearId: fiscalYear.id })
  }
  return fiscalYear
}

/**
 * Changes the dates of an open fiscal year of the company. Refused (409) on
 * a closed year, when the dates overlap another fiscal year of the company
 * (closed or not), and when entries of the year would fall outside them.
 */
export async function updateFiscalYearDates(companyId: string, fiscalYearId: string, input: { startDate: string; endDate: string }) {
  const { start, end } = datesOf(input)
  return prisma.$transaction(async (tx) => {
    await lockCompanyFiscalYears(tx, companyId)
    // Row lock: a closing of this year waits, then sees the new dates
    const fiscalYear = await lockFiscalYearRow(tx, fiscalYearId, companyId)
    if (!fiscalYear) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
    if (fiscalYear.closed) {
      throw new ConflictError(`L'exercice ${fiscalYear.year} est clôturé : ses dates ne peuvent plus être modifiées.`)
    }
    await assertNoFiscalYearOverlap(tx, companyId, { start, end }, fiscalYear.id)

    const outside = await tx.accountingEntry.count({
      where: {
        fiscalYearId: fiscalYear.id,
        OR: [{ date: { lte: new Date(start.getTime() - HALF_DAY_MS) } }, { date: { gte: new Date(end.getTime() + HALF_DAY_MS) } }],
      },
    })
    if (outside > 0) {
      throw new ConflictError(
        `${outside} écriture${outside > 1 ? 's' : ''} de l'exercice ${fiscalYear.year} ${outside > 1 ? 'seraient' : 'serait'} en dehors de ces dates : gardez une période qui les contient.`,
      )
    }

    // Ownership checked by the lock above
    return tx.fiscalYear.update({ where: { id: fiscalYear.id }, data: { startDate: start, endDate: end } })
  })
}

/**
 * Closes a fiscal year of the company (lib/accounting/fiscal-year-closure).
 * A refusal is a typed error whose `details` lists the blocking reasons:
 * 409 when the year is already closed, 400 otherwise.
 */
export async function closeCompanyFiscalYear(companyId: string, fiscalYearId: string, userId: string) {
  const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
  const result = await closeFiscalYear(companyId, fiscalYear.id, { userId })
  if (!result.success) {
    const error = result.alreadyClosed
      ? new ConflictError('Cet exercice est déjà clôturé')
      : new ValidationError("Impossible de clôturer l'exercice")
    throw error.withDetails({ details: result.errors ?? [] })
  }
  return result
}

/**
 * Simulation of the closing of a fiscal year of the company. A year that
 * cannot be closed is a 400 whose `details` and `warnings` list the reasons.
 */
export async function simulateCompanyFiscalYearClosure(companyId: string, fiscalYearId: string) {
  const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
  const result = await simulateFiscalYearClosure(companyId, fiscalYear.id)
  if (!result.success || !result.simulation) {
    // Blocked: the reasons, and the simulation on the entries as they are when it could be computed
    throw new ValidationError("L'exercice ne peut pas encore être clôturé").withDetails({
      details: result.errors ?? [],
      warnings: result.warnings ?? [],
      simulation: result.simulation ?? null,
    })
  }
  return result.simulation
}
