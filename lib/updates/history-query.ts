import { z } from 'zod'

/** Rows per page of GET /api/updates/history, also its maximum `limit`. */
export const HISTORY_PAGE_SIZE = 50

/**
 * Query of GET /api/updates/history (listVersionHistory): `cursor` is the id
 * of the last row of the previous page, `limit` at most 50.
 */
export const VersionHistoryQuerySchema = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(HISTORY_PAGE_SIZE).optional(),
})
