/**
 * Journal report generation service
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { sqlTimestamp } from '../ledger/aggregate'
import { fromCents } from '@/lib/utils/money'

export interface JournalEntryLine {
  accountCode: string
  accountLabel: string
  description: string | null
  debit: number
  credit: number
}

export interface JournalEntry {
  id: string
  entryNumber: string
  date: string
  description: string | null
  reference: string | null
  lines: JournalEntryLine[]
  totalDebit: number
  totalCredit: number
}

export interface JournalData {
  journal: {
    id: string
    code: string
    label: string
  }
  entries: JournalEntry[]
  totals: {
    debit: number
    credit: number
  }
}

export interface JournalReportData {
  journals: JournalData[]
  grandTotals: {
    debit: number
    credit: number
  }
}

export interface JournalReportParams {
  companyId: string
  journalId?: string | null
  startDate?: Date
  endDate?: Date
}

interface JournalLineRow {
  entryId: string
  entryNumber: string
  date: Date
  entryDescription: string | null
  reference: string | null
  journalId: string
  journalCode: string
  journalLabel: string
  accountCode: string
  accountLabel: string
  description: string | null
  debit: bigint
  credit: bigint
}

/**
 * Journal report (validated entries per journal, with their lines).
 *
 * One flat query (entries, lines, accounts and journals joined, amounts in
 * cents) instead of nested relation loading: a year of a busy company has
 * tens of thousands of lines, beyond what IN lists of bind parameters allow.
 * Order: entries by date then entry number (text order, as before), lines by
 * debit descending; totals summed in cents.
 */
export async function getJournalReport(
  params: JournalReportParams
): Promise<JournalReportData> {
  const { companyId, journalId, startDate, endDate } = params

  const rows = await prisma.$queryRaw<JournalLineRow[]>`
    SELECT e."id" AS "entryId", e."entryNumber", e."date", e."description" AS "entryDescription", e."reference",
           j."id" AS "journalId", j."code" AS "journalCode", j."label" AS "journalLabel",
           a."code" AS "accountCode", a."label" AS "accountLabel", l."description",
           (l."debit" * 100)::bigint AS debit, (l."credit" * 100)::bigint AS credit
    FROM "accounting_entries" e
    JOIN "journals" j ON j."id" = e."journalId"
    JOIN "entry_lines" l ON l."accountingEntryId" = e."id"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."companyId" = ${companyId}
      AND e."status" = 'validated'
      ${journalId && journalId !== 'all' ? Prisma.sql`AND e."journalId" = ${journalId}` : Prisma.empty}
      ${startDate && endDate ? Prisma.sql`AND e."date" >= ${sqlTimestamp(startDate)} AND e."date" <= ${sqlTimestamp(endDate)}` : Prisma.empty}
    ORDER BY e."date" ASC, e."entryNumber" ASC, e."id" ASC, l."debit" DESC, l."id" ASC
  `

  interface Totals { debitCents: number; creditCents: number }
  const journalsMap = new Map<string, { data: JournalData; totals: Totals }>()
  let current: { entry: JournalEntry; totals: Totals; journal: Totals } | null = null

  const closeEntry = () => {
    if (!current) return
    current.entry.totalDebit = fromCents(current.totals.debitCents)
    current.entry.totalCredit = fromCents(current.totals.creditCents)
    current.journal.debitCents += current.totals.debitCents
    current.journal.creditCents += current.totals.creditCents
  }

  for (const row of rows) {
    if (!current || current.entry.id !== row.entryId) {
      closeEntry()
      let journal = journalsMap.get(row.journalId)
      if (!journal) {
        journal = {
          data: { journal: { id: row.journalId, code: row.journalCode, label: row.journalLabel }, entries: [], totals: { debit: 0, credit: 0 } },
          totals: { debitCents: 0, creditCents: 0 },
        }
        journalsMap.set(row.journalId, journal)
      }
      const entry: JournalEntry = {
        id: row.entryId,
        entryNumber: row.entryNumber,
        date: row.date.toISOString(),
        description: row.entryDescription,
        reference: row.reference,
        lines: [],
        totalDebit: 0,
        totalCredit: 0,
      }
      journal.data.entries.push(entry)
      current = { entry, totals: { debitCents: 0, creditCents: 0 }, journal: journal.totals }
    }
    const debit = Number(row.debit)
    const credit = Number(row.credit)
    current.entry.lines.push({
      accountCode: row.accountCode,
      accountLabel: row.accountLabel,
      description: row.description,
      debit: fromCents(debit),
      credit: fromCents(credit),
    })
    current.totals.debitCents += debit
    current.totals.creditCents += credit
  }
  closeEntry()

  const journals = Array.from(journalsMap.values()).sort((a, b) => a.data.journal.code.localeCompare(b.data.journal.code))
  let grandDebit = 0
  let grandCredit = 0
  for (const journal of journals) {
    journal.data.totals = { debit: fromCents(journal.totals.debitCents), credit: fromCents(journal.totals.creditCents) }
    grandDebit += journal.totals.debitCents
    grandCredit += journal.totals.creditCents
  }

  return {
    journals: journals.map((j) => j.data),
    grandTotals: { debit: fromCents(grandDebit), credit: fromCents(grandCredit) },
  }
}
