/**
 * One list paged across several companies (the group transactions): each
 * company answers its rows after the cursor in the list's order, at most
 * `limit + 1`; the rows are merged and the first `limit` kept. Because every
 * company applies the same cursor and order, the merged page is exactly the
 * page the union would give, and the next cursor is the last row kept.
 * Pure (server side: cursors use Buffer).
 *
 * Order: newest first, then by id (descending) to break ties, so two rows
 * of the same day never swap between pages.
 */

export interface PageKey {
  /** Calendar day or ISO timestamp, compared as text (both ISO 8601). */
  date: string
  id: string
}

/** Descending (date, id): newest first. */
export function compareKeys(a: PageKey, b: PageKey): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  if (a.id !== b.id) return a.id < b.id ? 1 : -1
  return 0
}

export function encodeCursor(key: PageKey): string {
  return Buffer.from(JSON.stringify([key.date, key.id]), 'utf8').toString('base64url')
}

/** The key of a cursor, or null when it is not one of ours. */
export function decodeCursor(cursor: string | null | undefined): PageKey | null {
  if (!cursor) return null
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string' && !Number.isNaN(Date.parse(value[0]))) {
      return { date: value[0], id: value[1] }
    }
  } catch {
    // not a cursor: the caller answers a 400
  }
  return null
}

/** The first `limit` rows of the lists merged in key order, and the cursor of the next page. */
export function mergePages<T>(lists: ReadonlyArray<readonly T[]>, limit: number, keyOf: (row: T) => PageKey): { items: T[]; nextCursor: string | null } {
  const all = lists.flat().sort((a, b) => compareKeys(keyOf(a), keyOf(b)))
  const items = all.slice(0, limit)
  const nextCursor = all.length > limit && items.length > 0 ? encodeCursor(keyOf(items[items.length - 1])) : null
  return { items, nextCursor }
}
