/**
 * Updates a draft accounting entry, and validates it when status becomes
 * "validated".
 *
 * A validated entry is definitive (PCG art. 1031-3): editing it, deleting it
 * or putting it back to draft is refused with a ConflictError (409); it can
 * only be cancelled by a reversing entry (reverseEntry).
 *
 * @example
 * const entry = await updateAccountingEntry('entry-123', { description: 'Updated' })
 * const validated = await updateAccountingEntry('entry-123', { status: 'validated' })
 */

import type { EntryStatus } from '../types'
import { updateDraftEntry, type EntryLineInput } from './entry-lifecycle.service'

export async function updateAccountingEntry(
  entryId: string,
  data: {
    journalId?: string
    date?: Date | string
    description?: string | null
    reference?: string | null
    pieceDate?: Date | string | null
    status?: EntryStatus
    lines?: EntryLineInput[]
  },
  /** Restricts the update to an entry of this company. */
  companyId?: string,
) {
  return updateDraftEntry(entryId, data, companyId)
}
