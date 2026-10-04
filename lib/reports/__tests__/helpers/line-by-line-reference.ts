/**
 * The line by line implementations of the reports, as they were before the
 * totals moved to SQL aggregates (commit 3d4d006). They load every entry line
 * into the server and sum in JavaScript. Kept only as the reference of the
 * differential test (aggregate-differential.db.test.ts): the SQL versions
 * must give the same results on the same books. Not used by the app.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { startOfDay, endOfDay, normalizeDate } from '@/lib/utils/date'
import { isClosingEntry, OPENING_JOURNAL } from '@/lib/accounting/fiscal-year-closure/constants'
import { parseCents, toCents } from '@/lib/utils/money'
import type { AccountBalance, ReportPeriod } from '@/lib/reports/types'
import type { LedgerAccount, LedgerLine, LedgerQuery, LedgerReport } from '@/lib/reports/ledger/ledger.service'
import type { JournalData, JournalReportData, JournalReportParams } from '@/lib/reports/journal/get-journal-report.service'
import type { FecLedgerEntry } from '@/lib/fec/export'
import type { TreasuryEvolutionData } from '@/lib/reports/treasury-evolution'
import type { ImbalanceDiagnostic } from '@/lib/reports/balance-sheet/types'

export async function referenceAccountBalances(
  companyId: string,
  period?: ReportPeriod,
  fiscalYearId?: string,
  excludeClosingEntries: boolean = false
): Promise<AccountBalance[]> {
  // Step 1: Determine the fiscal year
  let targetFiscalYearId: string | undefined = fiscalYearId
  
  if (!targetFiscalYearId && period) {
    // Find fiscal year that contains the period
    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: {
        companyId,
        startDate: { lte: period.endDate },
        endDate: { gte: period.startDate },
      },
    })
    if (fiscalYear) {
      targetFiscalYearId = fiscalYear.id
    }
  }

  if (!targetFiscalYearId) {
    // If no fiscal year found, return empty balances
    return []
  }

  // Step 2: Retrieve all accounts for the company and fiscal year
  const allAccounts = await prisma.account.findMany({
    where: {
      companyId,
      fiscalYearId: targetFiscalYearId,
    },
    orderBy: { code: 'asc' },
  })

  if (allAccounts.length === 0) {
    return []
  }

  // Step 3: Initialize map with all accounts and create account IDs array
  const balancesMap = new Map<string, AccountBalance>()
  const accountIds: string[] = []
  for (const account of allAccounts) {
    accountIds.push(account.id)
    balancesMap.set(account.id, {
      accountId: account.id,
      code: account.code,
      label: account.label,
      debit: 0,
      credit: 0,
      balance: 0,
    })
  }

  // Step 4: Calculate balances from validated entries
  // Query entry lines directly for better performance and accuracy
  // Use fiscalYearId and accountFiscalYearId to filter entries and accounts of the fiscal year
  const entryLines = await prisma.entryLine.findMany({
    where: {
      accountFiscalYearId: targetFiscalYearId,
      accountId: {
        in: accountIds,
      },
      accountingEntry: {
        companyId,
        fiscalYearId: targetFiscalYearId,
        status: 'validated',
        // Optionally filter by date if period is provided (for partial period)
        ...(period && {
          date: {
            gte: startOfDay(period.startDate),
            lte: endOfDay(period.endDate),
          },
        }),
      },
    },
    include: {
      accountingEntry: {
        select: {
          journal: {
            select: {
              code: true,
            },
          },
          reference: true,
        },
      },
    },
  })

  // Step 5: Calculate balances from entry lines, in cents (no floating
  // point drift over thousands of lines)
  const cents = new Map<string, { debit: number; credit: number }>()
  for (const line of entryLines) {
    if (excludeClosingEntries && isClosingEntry(line.accountingEntry)) continue

    const accountId = line.accountId
    if (!balancesMap.has(accountId)) continue

    const totals = cents.get(accountId) ?? { debit: 0, credit: 0 }
    totals.debit += (parseCents(line.debit) ?? 0)
    totals.credit += (parseCents(line.credit) ?? 0)
    cents.set(accountId, totals)
  }
  for (const [accountId, totals] of cents) {
    const balance = balancesMap.get(accountId)!
    balance.debit = totals.debit / 100
    balance.credit = totals.credit / 100
    balance.balance = (totals.debit - totals.credit) / 100
  }

  return Array.from(balancesMap.values())
}

/** Splits a signed balance (cents) into a debit or a credit balance. */
function sides(balanceCents: number) {
  return {
    debit: balanceCents > 0 ? balanceCents / 100 : 0,
    credit: balanceCents < 0 ? -balanceCents / 100 : 0,
    balance: balanceCents / 100,
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


export async function referenceLedger(query: LedgerQuery): Promise<LedgerReport> {
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
  if (!fiscalYear) throw new Error('Aucun exercice comptable ne couvre cette période')

  // The period, clamped to the fiscal year.
  const fyStart = normalizeDate(fiscalYear.startDate)
  const fyEnd = normalizeDate(fiscalYear.endDate)
  let start = query.startDate ? normalizeDate(query.startDate) : fyStart
  let end = query.endDate ? normalizeDate(query.endDate) : fyEnd
  if (start < fyStart) start = fyStart
  if (end > fyEnd) end = fyEnd
  if (end < start) throw new Error('La date de fin précède la date de début')
  const periodStart = startOfDay(start)
  const periodEnd = endOfDay(end)

  const [accounts, lines] = await Promise.all([
    prisma.account.findMany({
      where: { companyId, fiscalYearId: fiscalYear.id },
      select: { id: true, code: true, label: true },
    }),
    prisma.entryLine.findMany({
      where: {
        accountFiscalYearId: fiscalYear.id,
        accountingEntry: {
          companyId,
          fiscalYearId: fiscalYear.id,
          status: 'validated',
          date: { lte: periodEnd },
        },
      },
      select: {
        id: true,
        accountId: true,
        debit: true,
        credit: true,
        description: true,
        accountingEntry: {
          select: {
            id: true,
            entryNumber: true,
            date: true,
            reference: true,
            description: true,
            journal: { select: { code: true, label: true } },
          },
        },
      },
    }),
  ])

  interface Acc {
    openingCents: number
    debitCents: number
    creditCents: number
    lines: Array<(typeof lines)[number]>
  }
  const byAccount = new Map<string, Acc>()
  for (const line of lines) {
    const acc = byAccount.get(line.accountId) ?? { openingCents: 0, debitCents: 0, creditCents: 0, lines: [] }
    const debit = (parseCents(line.debit) ?? 0)
    const credit = (parseCents(line.credit) ?? 0)
    const entry = line.accountingEntry
    const isOpening = entry.journal.code === OPENING_JOURNAL.code || entry.date < periodStart
    if (isOpening) {
      acc.openingCents += debit - credit
    } else {
      acc.debitCents += debit
      acc.creditCents += credit
      acc.lines.push(line)
    }
    byAccount.set(line.accountId, acc)
  }

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
      ? acc.lines
          .sort((a, b) => compareLines(a.accountingEntry, b.accountingEntry))
          .map((line) => {
            const debit = (parseCents(line.debit) ?? 0)
            const credit = (parseCents(line.credit) ?? 0)
            running += debit - credit
            return {
              id: line.id,
              entryId: line.accountingEntry.id,
              entryNumber: line.accountingEntry.entryNumber,
              date: line.accountingEntry.date.toISOString(),
              reference: line.accountingEntry.reference ?? '',
              journal: line.accountingEntry.journal,
              description: line.description || line.accountingEntry.description || '',
              debit: debit / 100,
              credit: credit / 100,
              runningBalance: running / 100,
            }
          })
      : []

    result.push({
      account,
      opening,
      movements: { debit: acc.debitCents / 100, credit: acc.creditCents / 100 },
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
      opening: { debit: totals.openingDebit / 100, credit: totals.openingCredit / 100 },
      movements: { debit: totals.debit / 100, credit: totals.credit / 100 },
      closing: { debit: totals.closingDebit / 100, credit: totals.closingCredit / 100 },
    },
  }
}

export async function referenceClassTotals(
  companyId: string,
  startDate: Date,
  endDate: Date
): Promise<{ revenue: number; expenses: number }> {
  const lines = await prisma.entryLine.findMany({
    where: {
      accountingEntry: {
        companyId,
        status: 'validated',
        date: { gte: startDate, lte: endDate },
      },
    },
    select: {
      debit: true,
      credit: true,
      account: { select: { code: true } },
      accountingEntry: {
        select: {
          reference: true,
          journal: { select: { code: true } },
        },
      },
    },
  })

  let revenue = 0
  let expenses = 0
  for (const line of lines) {
    if (!line.accountingEntry) continue
    if (isClosingEntry(line.accountingEntry)) continue
    const code = line.account?.code ?? ''
    const debit = Number(line.debit)
    const credit = Number(line.credit)
    if (code.startsWith('7')) {
      revenue += credit - debit
    } else if (code.startsWith('6')) {
      expenses += debit - credit
    }
  }

  return { revenue, expenses }
}


export async function referenceMonthlyData(
  companyId: string,
  window: { start: Date; end: Date; months: Array<{ year: number; month: number }> }
): Promise<Array<{ month: string; revenue: number; expenses: number }>> {
  const lines = await prisma.entryLine.findMany({
    where: {
      accountingEntry: {
        companyId,
        status: 'validated',
        date: { gte: window.start, lte: window.end },
      },
    },
    select: {
      debit: true,
      credit: true,
      accountingEntry: {
        select: {
          date: true,
          reference: true,
          journal: { select: { code: true } },
        },
      },
      account: { select: { code: true } },
    },
  })

  const buckets = new Map<string, { month: string; revenue: number; expenses: number }>()
  for (const { year, month } of window.months) {
    const key = `${year}-${month}`
    const d = new Date(Date.UTC(year, month, 1))
    buckets.set(key, {
      month: d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      revenue: 0,
      expenses: 0,
    })
  }

  for (const line of lines) {
    const entry = line.accountingEntry
    if (!entry) continue
    if (isClosingEntry(entry)) continue
    const date = entry.date
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`
    const bucket = buckets.get(key)
    if (!bucket) continue
    const code = line.account?.code ?? ''
    const debit = Number(line.debit)
    const credit = Number(line.credit)
    if (code.startsWith('7')) {
      bucket.revenue += credit - debit
    } else if (code.startsWith('6')) {
      bucket.expenses += debit - credit
    }
  }

  return Array.from(buckets.values())
}

export async function referenceTreasury(
  companyId: string,
  window: { start: Date; end: Date; months: Array<{ year: number; month: number }> }
): Promise<TreasuryEvolutionData[]> {
  const where: Prisma.BankTransactionWhereInput = {
    bankAccount: {
      bankConnection: {
        companyId,
      },
    },
    date: {
      lte: window.end,
    },
  }

  const transactions = await prisma.bankTransaction.findMany({
    where,
    include: {
      bankAccount: {
        include: {
          bankConnection: true,
        },
      },
    },
    orderBy: {
      date: 'asc',
    },
  })

  let initialBalance = 0
  for (const transaction of transactions) {
    if (transaction.date < window.start) {
      if (transaction.side === 'credit') {
        initialBalance += Number(transaction.amount)
      } else if (transaction.side === 'debit') {
        initialBalance -= Number(transaction.amount)
      }
    }
  }

  const monthlyData = new Map<string, { inflows: number; outflows: number }>()

  for (const transaction of transactions) {
    const transactionDate = new Date(transaction.date)

    if (transactionDate < window.start || transactionDate > window.end) {
      continue
    }

    const monthKey = `${transactionDate.getUTCFullYear()}-${String(transactionDate.getUTCMonth() + 1).padStart(2, '0')}`

    if (!monthlyData.has(monthKey)) {
      monthlyData.set(monthKey, { inflows: 0, outflows: 0 })
    }

    const monthData = monthlyData.get(monthKey)!
    const amount = Number(transaction.amount)

    if (transaction.side === 'credit') {
      monthData.inflows += amount
    } else if (transaction.side === 'debit') {
      monthData.outflows += amount
    }
  }

  const data: TreasuryEvolutionData[] = []
  let cumulative = initialBalance

  for (const { year, month } of window.months) {
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
    const monthData = monthlyData.get(monthKey) || { inflows: 0, outflows: 0 }
    const netVariation = monthData.inflows - monthData.outflows
    cumulative += netVariation

    const monthDate = new Date(Date.UTC(year, month, 1))
    data.push({
      month: monthDate.toLocaleDateString('fr-FR', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      inflows: monthData.inflows,
      outflows: monthData.outflows,
      cumulative,
    })
  }

  return data
}

export async function referenceJournal(
  params: JournalReportParams
): Promise<JournalReportData> {
  const { companyId, journalId, startDate, endDate } = params

  const whereClause: Prisma.AccountingEntryWhereInput = {
    companyId,
    status: 'validated',
    ...(journalId && journalId !== 'all' ? { journalId } : {}),
    ...(startDate && endDate
      ? {
          date: {
            gte: startDate,
            lte: endDate,
          },
        }
      : {}),
  }

  const entries = await prisma.accountingEntry.findMany({
    where: whereClause,
    include: {
      journal: true,
      lines: {
        include: { account: true },
        orderBy: [{ debit: 'desc' }],
      },
    },
    orderBy: [{ date: 'asc' }, { entryNumber: 'asc' }],
  })

  const journalsMap = new Map<string, JournalData>()

  for (const entry of entries) {
    const jid = entry.journalId
    const journal = entry.journal

    if (!journalsMap.has(jid)) {
      journalsMap.set(jid, {
        journal: { id: journal.id, code: journal.code, label: journal.label },
        entries: [],
        totals: { debit: 0, credit: 0 },
      })
    }

    const journalData = journalsMap.get(jid)!
    const totalDebit = entry.lines.reduce((sum, line) => sum + Number(line.debit), 0)
    const totalCredit = entry.lines.reduce((sum, line) => sum + Number(line.credit), 0)

    journalData.entries.push({
      id: entry.id,
      entryNumber: entry.entryNumber,
      date: entry.date.toISOString(),
      description: entry.description,
      reference: entry.reference,
      lines: entry.lines.map((line) => ({
        accountCode: line.account.code,
        accountLabel: line.account.label,
        description: line.description,
        debit: Number(line.debit),
        credit: Number(line.credit),
      })),
      totalDebit,
      totalCredit,
    })

    journalData.totals.debit += totalDebit
    journalData.totals.credit += totalCredit
  }

  const journalsData = Array.from(journalsMap.values()).sort((a, b) =>
    a.journal.code.localeCompare(b.journal.code)
  )

  return {
    journals: journalsData,
    grandTotals: {
      debit: journalsData.reduce((sum, j) => sum + j.totals.debit, 0),
      credit: journalsData.reduce((sum, j) => sum + j.totals.credit, 0),
    },
  }
}

export async function referenceFecLedger(companyId: string, fiscalYearId: string): Promise<FecLedgerEntry[]> {
  const entries = await prisma.accountingEntry.findMany({
    where: { companyId, fiscalYearId, status: 'validated' },
    select: {
      entryNumber: true,
      date: true,
      reference: true,
      pieceDate: true,
      description: true,
      validatedAt: true,
      journal: { select: { code: true, label: true } },
      lines: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          description: true,
          debit: true,
          credit: true,
          auxiliaryAccountNumber: true,
          auxiliaryAccountLabel: true,
          letteringCode: true,
          letteringDate: true,
          currencyAmount: true,
          currencyCode: true,
          account: { select: { code: true, label: true } },
        },
      },
    },
  })
  return entries.map((entry) => ({
    journalCode: entry.journal.code,
    journalLabel: entry.journal.label,
    entryNumber: entry.entryNumber,
    date: entry.date,
    reference: entry.reference,
    pieceDate: entry.pieceDate,
    description: entry.description,
    validatedAt: entry.validatedAt,
    lines: entry.lines.map((line) => ({
      accountCode: line.account.code,
      accountLabel: line.account.label,
      auxiliaryAccountNumber: line.auxiliaryAccountNumber,
      auxiliaryAccountLabel: line.auxiliaryAccountLabel,
      description: line.description,
      debit: line.debit,
      credit: line.credit,
      letteringCode: line.letteringCode,
      letteringDate: line.letteringDate,
      currencyAmount: line.currencyAmount,
      currencyCode: line.currencyCode,
    })),
  }))
}


export async function referenceUnbalancedEntries(
  companyId: string,
  fiscalYearId: string
): Promise<ImbalanceDiagnostic['causes']['unbalancedEntries']> {
  const entries = await prisma.accountingEntry.findMany({
    where: { companyId, fiscalYearId, status: 'validated' },
    select: { id: true, reference: true, entryNumber: true, date: true, lines: { select: { debit: true, credit: true } } },
  })
  const out: ImbalanceDiagnostic['causes']['unbalancedEntries'] = []
  for (const entry of entries) {
    const debit = entry.lines.reduce((s, l) => s + (toCents(l.debit) ?? 0), 0)
    const credit = entry.lines.reduce((s, l) => s + (toCents(l.credit) ?? 0), 0)
    if (debit !== credit) {
      out.push({
        entryId: entry.id,
        reference: entry.reference || entry.entryNumber,
        date: entry.date,
        debitTotal: debit / 100,
        creditTotal: credit / 100,
        difference: (debit - credit) / 100,
        link: `/${companyId}/entries/${entry.id}`,
      })
    }
  }
  return out
}
