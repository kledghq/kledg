/**
 * Entries of an imported CSV or Excel journal that the company already holds,
 * so that importing the same file twice creates nothing twice.
 *
 * The number of an entry in the file is not a key: Kledg gives every imported
 * entry its definitive number at validation, in the fiscal year sequence
 * (PCG art. 1031-3), so the file's entry "1" says nothing about the entry
 * numbered 1 in Kledg. An imported entry is a duplicate when the company
 * already holds an entry with the same journal, day, description, reference
 * and lines (account, debit and credit in cents). Each existing entry matches
 * one file entry at most: two identical entries of a file (two bank fees of
 * the same day) are both imported the first time, and neither the second.
 */

import { prisma } from '@/lib/prisma'
import { addUtcDays, calendarDayOf } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'

export interface ImportedEntry {
  journalId: string
  date: Date
  description: string | null
  reference: string | null
  lines: Array<{ accountId: string; debitCents: number; creditCents: number }>
}

/** Comparison key of an entry: journal, day, texts and the sorted lines. */
function entryFingerprint(entry: ImportedEntry): string {
  const lines = entry.lines.map((l) => `${l.accountId}:${l.debitCents}:${l.creditCents}`).sort()
  return JSON.stringify([entry.journalId, calendarDayOf(entry.date), entry.description ?? '', entry.reference ?? '', lines])
}

export interface ExistingEntries {
  /** Whether the entry is already in the company; a match is used once. */
  take(entry: ImportedEntry): boolean
}

/** Existing entries of the company in the journals and days of the file. */
export async function loadExistingEntries(companyId: string, journalIds: string[], dates: Date[]): Promise<ExistingEntries> {
  const counts = new Map<string, number>()
  const valid = dates.filter((d) => !Number.isNaN(d.getTime()))
  if (journalIds.length > 0 && valid.length > 0) {
    const times = valid.map((d) => d.getTime())
    // One day of margin: older entries were stored at local midnight in Paris
    const rows = await prisma.accountingEntry.findMany({
      where: {
        companyId,
        journalId: { in: journalIds },
        date: { gte: addUtcDays(new Date(Math.min(...times)), -1), lte: addUtcDays(new Date(Math.max(...times)), 1) },
      },
      select: {
        journalId: true,
        date: true,
        description: true,
        reference: true,
        lines: { select: { accountId: true, debit: true, credit: true } },
      },
    })
    for (const row of rows) {
      const key = entryFingerprint({
        journalId: row.journalId,
        date: row.date,
        description: row.description,
        reference: row.reference,
        lines: row.lines.map((l) => ({
          accountId: l.accountId,
          debitCents: parseCents(l.debit.toString()) ?? 0,
          creditCents: parseCents(l.credit.toString()) ?? 0,
        })),
      })
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return {
    take(entry) {
      const key = entryFingerprint(entry)
      const left = counts.get(key) ?? 0
      if (left === 0) return false
      counts.set(key, left - 1)
      return true
    },
  }
}
