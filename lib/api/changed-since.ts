/**
 * Lists read by a sync: the rows of a company changed at or after an instant
 * (`updatedSince`), oldest change first, then by id, page by page.
 *
 * The cursor holds the (updatedAt, id) of the last row of a page (keyset
 * paging, encoded like the group lists, lib/group/merge-pages.ts), not the
 * row's id alone. A row changed between two pages moves to the end of the
 * list and is read again; a row deleted meanwhile leaves the next page as it
 * was. Paging by the id of a row whose updatedAt moved would start the next
 * page after its new place and skip every row in between. The cursor names
 * no row to look up, so it reveals nothing of another company.
 */

import { ValidationError } from '@/lib/accounting/errors'
import { decodeCursor, encodeCursor } from '@/lib/group/merge-pages'

/** A list cursor that is not one of the list's own. */
export const INVALID_CURSOR = 'Curseur invalide\u00a0: rechargez la liste.'

/** Filter of the rows changed at or after `since`, after the row of `cursor` in (updatedAt, id) order. */
export function changedSinceWhere(since: Date, cursor: string | undefined) {
  if (!cursor) return { updatedAt: { gte: since } }
  const after = decodeCursor(cursor)
  if (!after) throw new ValidationError(INVALID_CURSOR)
  const at = new Date(after.date)
  return { updatedAt: { gte: since }, OR: [{ updatedAt: { gt: at } }, { updatedAt: at, id: { gt: after.id } }] }
}

/** Order of a changes list: oldest change first, ties by id. */
export function changedSinceOrder(): Array<{ updatedAt: 'asc' } | { id: 'asc' }> {
  return [{ updatedAt: 'asc' }, { id: 'asc' }]
}

/** The page of `rows` (read with `limit + 1`) and the cursor of the next page, null on the last one. */
export function changesPage<T extends { id: string; updatedAt: Date }>(rows: readonly T[], limit: number): { page: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { page, nextCursor: rows.length > limit && last ? encodeCursor({ date: last.updatedAt.toISOString(), id: last.id }) : null }
}
