/**
 * General ledger (grand livre) and trial balance (balance) of a period,
 * from one computation, so that they always agree.
 *
 * The period lies within one fiscal year (the chart of accounts and the
 * entries belong to a fiscal year). For each account:
 * - opening balance (solde à nouveau): the opening entry of the year
 *   (journal AN, the balances brought forward from the previous year) and
 *   every entry of the year dated before the period;
 * - movements: the other entries dated within the period;
 * - closing balance: opening + movements.
 * Only validated entries count. Dates are calendar days (UTC), so an entry
 * dated 31/12 is in the period ending on 31/12 whatever the server timezone.
 *
 * Totals: the sum of the debit balances equals the sum of the credit
 * balances, and the debit and credit movements are equal, on a balanced
 * ledger.
 */

import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { endOfDay, normalizeDate, startOfDay } from '@/lib/utils/date'
import { OPENING_JOURNAL } from '@/lib/accounting/fiscal-year-closure/constants'
import { sqlTimestamp, sumLedgerTotals } from './aggregate'
import { fromCents } from '@/lib/utils/money'

export interface LedgerLine {
  id: string
  entryId: string
  entryNumber: string
  date: string
  reference: string
  journal: { code: string; label: string }
  description: string
  debit: number
  credit: number
  /** Running balance of the account after this line (debit - credit). */
  runningBalance: number
}

export interface LedgerAccount {
  account: { id: string; code: string; label: string }
  opening: { debit: number; credit: number; balance: number }
  movements: { debit: number; credit: number }
  closing: { debit: number; credit: number; balance: number }
  lines: LedgerLine[]
}

export interface LedgerTotals {
  opening: { debit: number; credit: number }
  movements: { debit: number; credit: number }
  closing: { debit: number; credit: number }
}

export interface LedgerReport {
  fiscalYear: { id: string; year: number; startDate: string; endDate: string; isClosed: boolean }
  period: { startDate: string; endDate: string }
  accounts: LedgerAccount[]
  totals: LedgerTotals
}

export interface LedgerQuery {
  companyId: string
  fiscalYearId?: string
  /** First day of the period (defaults to the start of the fiscal year). */
  startDate?: Date
  /** Last day of the period (defaults to the end of the fiscal year). */
  endDate?: Date
  /** Include the entry lines (grand livre); the balance only needs totals. */
  withLines?: boolean
}

/** Splits a signed balance (cents) into a debit or a credit balance. */
function sides(balanceCents: number) {
  return {
    debit: balanceCents > 0 ? fromCents(balanceCents) : 0,
    credit: balanceCents < 0 ? fromCents(-balanceCents) : 0,
    balance: fromCents(balanceCents),
  }
}

/** Numeric order of entry numbers ("2" before "10"), then date. */
function compareLines(a: { date: Date; entryNumber: string }, b: { date: Date; entryNumber: string }): number {
  const byDate = a.date.getTime() - b.date.getTime()
  if (byDate !== 0) return byDate
  const na = Number(a.entryNumber.match(/\d+/g)?.pop() ?? NaN)
  const nb = Number(b.entryNumber.match(/\d+/g)?.pop() ?? NaN)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
  return a.entryNumber.localeCompare(b.entryNumber)
}

/** The period asked is outside every fiscal year or inverted: a 400 with a French message. */
export class LedgerPeriodError extends ValidationError {}

interface PeriodLine {
  id: string
  accountId: string
  debitCents: number
  creditCents: number
  description: string | null
  entryId: string
  entryNumber: string
  date: Date
  reference: string | null
  entryDescription: string | null
  journalCode: string
  journalLabel: string
}

/** Validated lines of the fiscal year dated within the period, opening entry (AN) excluded. */
async function loadPeriodLines(companyId: string, fiscalYearId: string, periodStart: Date, periodEnd: Date): Promise<PeriodLine[]> {
  const rows = await prisma.$queryRaw<Array<Omit<PeriodLine, 'debitCents' | 'creditCents'> & { debit: bigint; credit: bigint }>>`
    SELECT l."id", l."accountId", (l."debit" * 100)::bigint AS debit, (l."credit" * 100)::bigint AS credit,
           l."description", e."id" AS "entryId", e."entryNumber", e."date", e."reference",
           e."description" AS "entryDescription", j."code" AS "journalCode", j."label" AS "journalLabel"
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "journals" j ON j."id" = e."journalId"
    WHERE l."accountFiscalYearId" = ${fiscalYearId}
      AND e."companyId" = ${companyId}
      AND e."fiscalYearId" = ${fiscalYearId}
      AND e."status" = 'validated'
      AND e."date" >= ${sqlTimestamp(periodStart)}
      AND e."date" <= ${sqlTimestamp(periodEnd)}
      AND j."code" <> ${OPENING_JOURNAL.code}
    ORDER BY l."createdAt", l."id"
  `
  return rows.map(({ debit, credit, ...line }) => ({ ...line, debitCents: Number(debit), creditCents: Number(credit) }))
}

export async function getLedger(query: LedgerQuery): Promise<LedgerReport> {
  const { companyId } = query
  const fiscalYear = query.fiscalYearId
    ? await prisma.fiscalYear.findFirst({ where: { id: query.fiscalYearId, companyId } })
    : query.startDate
      ? await prisma.fiscalYear.findFirst({
          where: {
            companyId,
            startDate: { lte: endOfDay(query.startDate) },
            endDate: { gte: startOfDay(query.startDate) },
          },
        })
      : await prisma.fiscalYear.findFirst({ where: { companyId, isClosed: false }, orderBy: { year: 'desc' } })
  if (!fiscalYear) throw new LedgerPeriodError('Aucun exercice comptable ne couvre cette période')

  // The period, clamped to the fiscal year.
  const fyStart = normalizeDate(fiscalYear.startDate)
  const fyEnd = normalizeDate(fiscalYear.endDate)
  let start = query.startDate ? normalizeDate(query.startDate) : fyStart
  let end = query.endDate ? normalizeDate(query.endDate) : fyEnd
  if (start < fyStart) start = fyStart
  if (end > fyEnd) end = fyEnd
  if (end < start) throw new LedgerPeriodError('La date de fin précède la date de début')
  const periodStart = startOfDay(start)
  const periodEnd = endOfDay(end)

  // Totals are summed by PostgreSQL (lib/reports/ledger/aggregate.ts); the
  // lines of the period are read only for the grand livre, in one flat query
  // (no relation loading, whose IN lists exceed the bind parameter limit on
  // large years).
  const [accounts, totalsRows, periodLines] = await Promise.all([
    prisma.account.findMany({
      where: { companyId, fiscalYearId: fiscalYear.id },
      select: { id: true, code: true, label: true },
    }),
    sumLedgerTotals({ companyId, fiscalYearId: fiscalYear.id, periodStart, periodEnd }),
    query.withLines ? loadPeriodLines(companyId, fiscalYear.id, periodStart, periodEnd) : Promise.resolve([]),
  ])

  const linesByAccount = new Map<string, PeriodLine[]>()
  for (const line of periodLines) {
    const list = linesByAccount.get(line.accountId)
    if (list) list.push(line)
    else linesByAccount.set(line.accountId, [line])
  }
  const byAccount = new Map(totalsRows.map((row) => [row.accountId, row]))

  const totals = { openingDebit: 0, openingCredit: 0, debit: 0, credit: 0, closingDebit: 0, closingCredit: 0 }
  const result: LedgerAccount[] = []
  for (const account of [...accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    const acc = byAccount.get(account.id)
    if (!acc) continue
    const closingCents = acc.openingCents + acc.debitCents - acc.creditCents
    const opening = sides(acc.openingCents)
    const closing = sides(closingCents)
    totals.openingDebit += Math.max(acc.openingCents, 0)
    totals.openingCredit += Math.max(-acc.openingCents, 0)
    totals.debit += acc.debitCents
    totals.credit += acc.creditCents
    totals.closingDebit += Math.max(closingCents, 0)
    totals.closingCredit += Math.max(-closingCents, 0)

    let running = acc.openingCents
    const ledgerLines: LedgerLine[] = query.withLines
      ? (linesByAccount.get(account.id) ?? [])
          .sort(compareLines)
          .map((line) => {
            running += line.debitCents - line.creditCents
            return {
              id: line.id,
              entryId: line.entryId,
              entryNumber: line.entryNumber,
              date: line.date.toISOString(),
              reference: line.reference ?? '',
              journal: { code: line.journalCode, label: line.journalLabel },
              description: line.description || line.entryDescription || '',
              debit: fromCents(line.debitCents),
              credit: fromCents(line.creditCents),
              runningBalance: fromCents(running),
            }
          })
      : []

    result.push({
      account,
      opening,
      movements: { debit: fromCents(acc.debitCents), credit: fromCents(acc.creditCents) },
      closing,
      lines: ledgerLines,
    })
  }

  return {
    fiscalYear: {
      id: fiscalYear.id,
      year: fiscalYear.year,
      startDate: fiscalYear.startDate.toISOString(),
      endDate: fiscalYear.endDate.toISOString(),
      isClosed: fiscalYear.isClosed,
    },
    period: { startDate: start.toISOString(), endDate: end.toISOString() },
    accounts: result,
    totals: {
      opening: { debit: fromCents(totals.openingDebit), credit: fromCents(totals.openingCredit) },
      movements: { debit: fromCents(totals.debit), credit: fromCents(totals.credit) },
      closing: { debit: fromCents(totals.closingDebit), credit: fromCents(totals.closingCredit) },
    },
  }
}
