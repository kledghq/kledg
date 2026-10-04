/**
 * Creates an accounting entry (draft by default).
 *
 * Checks (PCG 2026): balanced to the cent, two lines at least, one side per
 * line, journal and accounts of the company, all accounts in one fiscal year,
 * fiscal year open and containing the date (lib/accounting/entry-guards.ts).
 *
 * Drafts get a provisional number. With status "validated" the entry is
 * validated in the same transaction and gets its definitive number from the
 * fiscal year sequence: a number passed by the caller is ignored, numbers are
 * only assigned at validation (see generate-next-entry-number.service.ts).
 *
 * @example
 * const entry = await createAccountingEntry({
 *   companyId: 'company-123',
 *   journalId: 'journal-456',
 *   date: '2026-01-15',
 *   description: 'Payment to supplier',
 *   lines: [
 *     { accountId: 'account-1', debit: '1000.00', credit: 0 },
 *     { accountId: 'account-2', debit: 0, credit: 1000 },
 *   ],
 * })
 */

import type { EntryStatus } from '../types'
import { createEntry, type EntryLineInput } from './entry-lifecycle.service'

export async function createAccountingEntry(data: {
  companyId: string
  journalId: string
  date: Date | string
  description?: string | null
  reference?: string | null
  pieceDate?: Date | string | null
  status?: EntryStatus
  lines: EntryLineInput[]
  /** Ignored: drafts are numbered provisionally, validated entries at validation. */
  entryNumber?: string
  fiscalYearId?: string
}) {
  return createEntry({
    companyId: data.companyId,
    journalId: data.journalId,
    date: data.date,
    description: data.description,
    reference: data.reference,
    pieceDate: data.pieceDate,
    status: data.status,
    lines: data.lines,
    fiscalYearId: data.fiscalYearId,
  })
}
