/**
 * Creates an accounting entry and returns the PCG warnings that do not block
 * it (same rules as createAccountingEntry).
 */

import { logger } from '@/lib/logger'
import type { EntryStatus } from '../types'
import type { AccountingEntryWithWarnings } from './types'
import { createEntry, entryWarnings, type EntryLineInput } from './entry-lifecycle.service'

export async function createAccountingEntryWithWarnings(data: {
  companyId: string
  journalId: string
  date: Date | string
  description: string
  reference?: string
  status?: EntryStatus
  lines: EntryLineInput[]
  /** Ignored: numbers are assigned at validation. */
  entryNumber?: string
}): Promise<AccountingEntryWithWarnings> {
  const entry = await createEntry({
    companyId: data.companyId,
    journalId: data.journalId,
    date: data.date,
    description: data.description,
    reference: data.reference,
    status: data.status,
    lines: data.lines,
  })
  const warnings = entryWarnings(data.description)
  if (warnings.length > 0) {
    logger.warn(`PCG Warnings for entry ${entry.entryNumber}: ${warnings.map((w) => w.message).join('; ')}`, {
      companyId: data.companyId,
      journalId: data.journalId,
      entryId: entry.id,
    })
  }
  return { entry, warnings }
}
