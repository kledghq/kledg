import { z } from 'zod'

/**
 * Query of GET /api/updates (getUpdateOverview): `?light=1` asks for the
 * header indicator only (no migrations, no connection); any other value
 * reads the full overview.
 */
export const UpdateOverviewQuerySchema = z.object({
  light: z.string().optional().transform((value) => value === '1'),
})
