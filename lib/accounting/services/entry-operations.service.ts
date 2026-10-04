/**
 * Entry operations of the API beyond the life cycle itself
 * (entry-lifecycle.service.ts): reading one entry of a company, duplicating
 * it as a draft and the bulk actions of the entries list. Every write goes
 * through the life cycle (createEntry, deleteDraftEntry, validateEntries):
 * a validated entry stays definitive (PCG art. 1031-3), each bulk item is
 * applied in its own transaction and a failure is reported for that item
 * only.
 */

import { prisma } from '@/lib/prisma'
import { handleError, NotFoundError } from '@/lib/accounting/errors'
import type { EntryStatus } from '../types'
import {
  createEntry,
  deleteDraftEntry,
  ENTRY_INCLUDE,
  immutableEntryMessage,
  validateEntries,
  type EntryWithRelations,
} from './entry-lifecycle.service'

export const ENTRY_NOT_FOUND = 'Écriture introuvable'

/** An entry of the company with its journal, lines and reversal links, or a 404. */
export async function getCompanyEntry(companyId: string, id: string): Promise<EntryWithRelations> {
  const entry = await prisma.accountingEntry.findFirst({ where: { id, companyId }, include: ENTRY_INCLUDE })
  if (!entry) throw new NotFoundError(ENTRY_NOT_FOUND)
  return entry
}

/** Status of an entry of the company, or a 404. */
export async function getEntryStatus(companyId: string, id: string): Promise<EntryStatus> {
  const entry = await prisma.accountingEntry.findFirst({ where: { id, companyId }, select: { status: true } })
  if (!entry) throw new NotFoundError(ENTRY_NOT_FOUND)
  return entry.status as EntryStatus
}

/**
 * Copies an entry of the company as a new draft (same journal, date,
 * description, reference and lines). The life cycle checks the journal,
 * accounts and fiscal year again: a copy into a closed year is refused.
 */
export async function duplicateEntry(companyId: string, id: string): Promise<EntryWithRelations> {
  const source = await prisma.accountingEntry.findFirst({
    where: { id, companyId },
    include: { lines: { orderBy: { createdAt: 'asc' } } },
  })
  if (!source) throw new NotFoundError(ENTRY_NOT_FOUND)

  return createEntry({
    companyId,
    journalId: source.journalId,
    date: source.date,
    description: source.description ?? '',
    reference: source.reference ?? undefined,
    status: 'draft',
    fiscalYearId: source.fiscalYearId,
    lines: source.lines.map((line) => ({
      accountId: line.accountId,
      debit: line.debit.toString(),
      credit: line.credit.toString(),
      description: line.description,
      auxiliaryAccountNumber: line.auxiliaryAccountNumber,
      auxiliaryAccountLabel: line.auxiliaryAccountLabel,
    })),
  })
}

export interface BulkItemError {
  entryId: unknown
  error: string
}

/** Ids that are non-empty strings, and an error for every other value. */
function splitIds(entryIds: unknown[]): { ids: string[]; invalid: BulkItemError[] } {
  const ids = entryIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  const invalid = entryIds.filter((id) => typeof id !== 'string' || !id).map((entryId) => ({ entryId, error: ENTRY_NOT_FOUND }))
  return { ids, invalid }
}

/**
 * Deletes drafts of the company, one transaction each. Validated entries
 * and ids of other companies are reported in `errors`, the others deleted.
 */
export async function deleteDraftEntries(companyId: string, entryIds: unknown[]) {
  const deleted: Array<{ id: string; description: string | null; reference: string | null }> = []
  const errors: BulkItemError[] = []
  for (const entryId of entryIds) {
    if (typeof entryId !== 'string' || !entryId) {
      errors.push({ entryId, error: ENTRY_NOT_FOUND })
      continue
    }
    try {
      // One transaction per draft: a refused entry never blocks the others
      deleted.push(await deleteDraftEntry(companyId, entryId))
    } catch (error) {
      errors.push({ entryId, error: handleError(error).message })
    }
  }
  return { deleted, errors }
}

/**
 * Sets the status of entries of the company. "validated" validates the
 * drafts in date order (definitive numbers follow the dates); "draft" is
 * refused for every entry: a validated entry can only be reversed.
 */
export async function setEntriesStatus(
  companyId: string,
  entryIds: unknown[],
  status: EntryStatus,
): Promise<{ validated: EntryWithRelations[]; errors: BulkItemError[] }> {
  const { ids, invalid } = splitIds(entryIds)

  if (status === 'draft') {
    const entries = await prisma.accountingEntry.findMany({
      where: { id: { in: ids }, companyId },
      select: { id: true, entryNumber: true, status: true },
    })
    const byId = new Map(entries.map((e) => [e.id, e]))
    const errors = ids.map((entryId) => {
      const entry = byId.get(entryId)
      if (!entry) return { entryId, error: ENTRY_NOT_FOUND }
      if (entry.status === 'validated') return { entryId, error: immutableEntryMessage(entry.entryNumber) }
      return { entryId, error: "L'écriture est déjà un brouillon." }
    })
    return { validated: [], errors: [...invalid, ...errors] }
  }

  const { validated, errors } = await validateEntries(companyId, ids)
  return { validated, errors: [...invalid, ...errors] }
}
