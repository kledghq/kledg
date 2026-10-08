/**
 * The numbering series of a company's sales invoices, in the database
 * (format.ts for the rules on plain values).
 *
 * Invariants owned here:
 * - a number of the series is given only when a sales invoice is posted,
 *   inside the posting transaction: its counter row (invoice_number_counters)
 *   is locked FOR UPDATE then updated, so two postings at once wait for each
 *   other and get two consecutive numbers, and a posting that rolls back
 *   gives its number back (the counter update rolls back with it). A draft
 *   has no number: deleting one leaves no gap;
 * - the advisory lock kledg:invoice-number:<company> is taken first, the
 *   same lock as the uniqueness check of a typed number
 *   (manage-invoices.service.ts), so a typed number and a number of the
 *   series are never given twice;
 * - numbers are chronological within a period (BOI-TVA-DECLA-30-20-20-10
 *   § 90): an invoice dated before one already numbered in the period is
 *   refused, not numbered after it;
 * - a counter created for a period starts after the highest number of the
 *   same format already recorded for the company (invoices numbered before
 *   the series existed keep their numbers), and a number already taken is
 *   never given again;
 * - the next number of the current period can be raised (a company coming
 *   from another tool) only before Kledg gives its first number of the
 *   period and without skipping numbers it knows, never lowered onto
 *   numbers already given (raiseNextNumbers).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, ValidationError } from '@/lib/accounting/errors'
import { dayToDate } from '@/lib/accounting/entry-date'
import { calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'
import {
  MAX_SEQUENCE,
  formatOf,
  parseSequence,
  periodOf,
  renderNumber,
  seriesOf,
  sequencePattern,
  typeCodesOf,
  type InvoiceNumberingSettings,
  type NumberFormat,
  type Series,
} from './format'
import { readNumberingSettings } from './settings'

type Db = Prisma.TransactionClient | typeof prisma

export async function loadNumberingSettings(db: Db, companyId: string): Promise<InvoiceNumberingSettings> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { invoiceNumbering: true } })
  return readNumberingSettings(company?.invoiceNumbering)
}

/** Serializes every number given or typed for the company's sales invoices. */
export async function lockInvoiceNumbers(tx: Prisma.TransactionClient, companyId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:invoice-number:${companyId}`}))`
}

interface Period {
  key: string
  year: number
  month: number
  /** Days the period covers; null: the series is never reset. */
  bounds: { start: string; end: string } | null
}

async function fiscalYearsOf(db: Db, companyId: string) {
  const years = await db.fiscalYear.findMany({ where: { companyId }, select: { id: true, startDate: true, endDate: true }, orderBy: { startDate: 'asc' } })
  return years.map((fy) => ({ id: fy.id, startDay: calendarDayOf(fy.startDate) as string, endDay: calendarDayOf(fy.endDate) as string }))
}

async function periodFor(db: Db, companyId: string, settings: InvoiceNumberingSettings, day: string): Promise<Period> {
  if (settings.reset === 'YEARLY') {
    const year = day.slice(0, 4)
    return { ...(periodOf('YEARLY', day, null) as Omit<Period, 'bounds'>), bounds: { start: `${year}-01-01`, end: `${year}-12-31` } }
  }
  if (settings.reset === 'NEVER') return { ...(periodOf('NEVER', day, null) as Omit<Period, 'bounds'>), bounds: null }
  const fiscalYear = (await fiscalYearsOf(db, companyId)).find((fy) => fy.startDay <= day && day <= fy.endDay)
  if (!fiscalYear) {
    throw new ValidationError(
      `Aucun exercice ne contient le ${formatIsoDateFr(day)} : la numérotation repart à chaque exercice, créez l’exercice avant d’émettre la facture.`,
    )
  }
  return { ...(periodOf('FISCAL_YEAR', day, fiscalYear) as Omit<Period, 'bounds'>), bounds: { start: fiscalYear.startDay, end: fiscalYear.endDay } }
}

/** Highest sequence of the format among the company's sales invoice numbers (0: none). */
async function highestRecorded(db: Db, companyId: string, format: NumberFormat, year: number | null): Promise<number> {
  const pattern = sequencePattern(format, year)
  const rows = await db.$queryRaw<Array<{ max: bigint | null }>>`
    SELECT max((substring("number" from ${pattern}))::bigint) AS "max"
    FROM "invoices"
    WHERE "companyId" = ${companyId} AND "direction" = 'SALE' AND "number" ~ ${pattern}`
  return Number(rows[0]?.max ?? 0)
}

const yearOfPeriod = (settings: InvoiceNumberingSettings, period: Period) => (settings.reset === 'NEVER' ? null : period.year)

async function numberTaken(db: Db, companyId: string, number: string) {
  return (await db.invoice.count({ where: { companyId, direction: 'SALE', number } })) > 0
}

/** The number the next invoice of this type and date would get, without giving it (drafts and the settings preview). Null: numbers are typed. */
export async function peekNextNumber(db: Db, companyId: string, typeCode: string, day: string, settings?: InvoiceNumberingSettings): Promise<string | null> {
  const config = settings ?? (await loadNumberingSettings(db, companyId))
  if (config.mode !== 'AUTO') return null
  const series = seriesOf(config, typeCode)
  const format = formatOf(config, series)
  const period = await periodFor(db, companyId, config, day).catch(() => null)
  if (!period) return null
  const counter = await db.invoiceNumberCounter.findUnique({ where: { companyId_series_periodKey: { companyId, series, periodKey: period.key } }, select: { lastValue: true } })
  const last = Math.max(counter?.lastValue ?? 0, await highestRecorded(db, companyId, format, yearOfPeriod(config, period)))
  return renderNumber(format, { year: period.year, month: period.month, sequence: last + 1 })
}

/** The counter row of a series and period, locked (created after the highest number already recorded when missing). */
async function lockedCounter(tx: Prisma.TransactionClient, companyId: string, settings: InvoiceNumberingSettings, series: Series, period: Period) {
  const select = () =>
    tx.$queryRaw<Array<{ id: string; lastValue: number }>>`
      SELECT "id", "lastValue" FROM "invoice_number_counters"
      WHERE "companyId" = ${companyId} AND "series" = ${series} AND "periodKey" = ${period.key}
      FOR UPDATE`
  let rows = await select()
  if (rows.length === 0) {
    const seed = await highestRecorded(tx, companyId, formatOf(settings, series), yearOfPeriod(settings, period))
    await tx.invoiceNumberCounter.createMany({ data: [{ companyId, series, periodKey: period.key, lastValue: seed }], skipDuplicates: true })
    rows = await select()
  }
  return rows[0]
}

/**
 * Gives the next number of the series to a sales invoice being posted, in
 * the posting transaction `tx` (see the module header).
 */
export async function assignSeriesNumber(tx: Prisma.TransactionClient, companyId: string, invoice: { id: string; typeCode: string; issueDay: string }): Promise<string> {
  await lockInvoiceNumbers(tx, companyId)
  const settings = await loadNumberingSettings(tx, companyId)
  const series = seriesOf(settings, invoice.typeCode)
  const format = formatOf(settings, series)
  const period = await periodFor(tx, companyId, settings, invoice.issueDay)

  // Chronological within the period: never a number after an invoice dated later.
  const later = await tx.invoice.findFirst({
    where: {
      companyId,
      direction: 'SALE',
      origin: 'AUTO',
      numberAssignedAt: { not: null },
      id: { not: invoice.id },
      typeCode: { in: typeCodesOf(settings, series) },
      issueDate: { gt: dayToDate(invoice.issueDay), ...(period.bounds ? { lte: dayToDate(period.bounds.end) } : {}) },
    },
    orderBy: { issueDate: 'desc' },
    select: { number: true, issueDate: true },
  })
  if (later) {
    throw new ConflictError(
      `La facture n° ${later.number} du ${formatIsoDateFr(calendarDayOf(later.issueDate) as string)} est déjà numérotée : une facture datée du ${formatIsoDateFr(invoice.issueDay)} ne peut pas recevoir le numéro suivant (numérotation chronologique, CGI ann. II art. 242 nonies A). Datez-la du ${formatIsoDateFr(calendarDayOf(later.issueDate) as string)} au plus tôt.`,
    )
  }

  const counter = await lockedCounter(tx, companyId, settings, series, period)
  let sequence = counter.lastValue + 1
  let number = renderNumber(format, { year: period.year, month: period.month, sequence })
  if (await numberTaken(tx, companyId, number)) {
    // A number of the same format was typed or imported meanwhile: continue after the highest one.
    sequence = Math.max(sequence, (await highestRecorded(tx, companyId, format, yearOfPeriod(settings, period))) + 1)
    number = renderNumber(format, { year: period.year, month: period.month, sequence })
    if (await numberTaken(tx, companyId, number)) throw new ConflictError(`Le numéro ${number} est déjà pris : vérifiez le format de la numérotation dans Informations.`)
  }
  if (sequence > MAX_SEQUENCE) throw new ConflictError('La série de numérotation est épuisée : changez le préfixe dans Informations.')
  await tx.invoiceNumberCounter.update({ where: { id: counter.id }, data: { lastValue: sequence } })
  return number
}

/**
 * Raises the next number of the current period of each series given
 * (`today` decides the period), for a company continuing a sequence started
 * in another tool. The sequence must stay "chronologique et continue" (CGI
 * ann. II art. 242 nonies A, I, 7°; BOI-TVA-DECLA-30-20-20-10), so a raise
 * never opens a gap in what Kledg knows:
 * - refused once Kledg has given a number of the series in the period: the
 *   numbers between would never be issued;
 * - when numbers of the series are already recorded in the period (typed or
 *   imported), only the number right after the highest one;
 * - otherwise any number above those already given: the sequence goes on
 *   from the other tool.
 * Refused below or onto a number already given: the series never gives a
 * number twice.
 */
export async function raiseNextNumbers(
  tx: Prisma.TransactionClient,
  companyId: string,
  settings: InvoiceNumberingSettings,
  next: { invoice?: number; creditNote?: number },
  today: string,
): Promise<void> {
  const wanted: Array<[Series, number]> = []
  if (next.invoice !== undefined) wanted.push(['INVOICE', next.invoice])
  if (next.creditNote !== undefined) {
    if (settings.creditNotes !== 'OWN_SERIES') throw new ValidationError('Les avoirs suivent la série des factures : réglez le prochain numéro des factures.')
    wanted.push(['CREDIT_NOTE', next.creditNote])
  }
  if (wanted.length === 0) return
  await lockInvoiceNumbers(tx, companyId)
  const period = await periodFor(tx, companyId, settings, today)
  for (const [series, value] of wanted) {
    const format = formatOf(settings, series)
    const counter = await lockedCounter(tx, companyId, settings, series, period)
    const recorded = await highestRecorded(tx, companyId, format, yearOfPeriod(settings, period))
    const floor = Math.max(counter.lastValue, recorded)
    if (value <= floor) {
      const last = renderNumber(format, { year: period.year, month: period.month, sequence: floor })
      throw new ConflictError(`Le numéro ${last} est déjà attribué : le prochain numéro doit être supérieur à ${floor} (la numérotation ne revient jamais en arrière).`)
    }
    const given = await tx.invoice.findFirst({
      where: {
        companyId,
        direction: 'SALE',
        origin: 'AUTO',
        numberAssignedAt: { not: null },
        typeCode: { in: typeCodesOf(settings, series) },
        ...(period.bounds ? { issueDate: { gte: dayToDate(period.bounds.start), lte: dayToDate(period.bounds.end) } } : {}),
      },
      select: { number: true },
    })
    if (given) {
      throw new ConflictError(
        `Kledg a déjà attribué le numéro ${given.number} dans cette période : relever le prochain numéro laisserait des numéros jamais émis, alors que la numérotation doit être continue (CGI ann. II art. 242 nonies A). Le prochain numéro ne se règle qu’avant la première facture numérotée par Kledg dans la période.`,
      )
    }
    if (recorded > 0 && value !== recorded + 1) {
      const highest = renderNumber(format, { year: period.year, month: period.month, sequence: recorded })
      const after = renderNumber(format, { year: period.year, month: period.month, sequence: recorded + 1 })
      throw new ConflictError(
        `La facture n° ${highest} est déjà enregistrée : le prochain numéro est ${after}, un numéro plus élevé laisserait un trou dans la numérotation continue (CGI ann. II art. 242 nonies A).`,
      )
    }
    await tx.invoiceNumberCounter.update({ where: { id: counter.id }, data: { lastValue: value - 1 } })
  }
}

/**
 * Refuses a typed number (an invoice already issued elsewhere) that falls in
 * a period where Kledg's series runs and is above its last number: Kledg
 * would give it later, twice. Numbers of periods where the series has not
 * started yet are history and accepted; the series then continues after
 * them.
 */
export async function assertOutsideRunningSeries(db: Db, companyId: string, number: string): Promise<void> {
  const settings = await loadNumberingSettings(db, companyId)
  if (settings.mode !== 'AUTO') return
  const counters = await db.invoiceNumberCounter.findMany({ where: { companyId }, select: { series: true, periodKey: true, lastValue: true } })
  if (counters.length === 0) return
  const fiscalYears = counters.some((c) => c.periodKey.startsWith('FY:')) ? await fiscalYearsOf(db, companyId) : []
  for (const counter of counters) {
    const series = counter.series as Series
    let year: number | null = null
    if (counter.periodKey === 'ALL') year = null
    else if (counter.periodKey.startsWith('FY:')) {
      const fy = fiscalYears.find((f) => `FY:${f.id}` === counter.periodKey)
      if (!fy) continue
      year = Number(fy.endDay.slice(0, 4))
    } else year = Number(counter.periodKey)
    if (settings.reset === 'NEVER' ? counter.periodKey !== 'ALL' : counter.periodKey === 'ALL') continue
    const sequence = parseSequence(formatOf(settings, series), year, number)
    if (sequence !== null && sequence > counter.lastValue) {
      throw new ConflictError(
        `Le numéro ${number} appartient à la série automatique de Kledg et ne lui a pas encore été attribué : Kledg le donnerait plus tard à une autre facture. Saisissez le numéro d’origine de la facture (s’il diffère) ou laissez Kledg la numéroter.`,
      )
    }
  }
}
