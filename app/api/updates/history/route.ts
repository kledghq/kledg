import { adminRoute, NextResponse } from '@/lib/api/route'
import { ensureVersionRecorded, listVersionHistory } from '@/lib/updates/history'
import { VersionHistoryQuerySchema } from '@/lib/updates/history-query'

export const dynamic = 'force-dynamic'

/**
 * Update history of the instance, newest first, 50 rows per page
 * (?cursor=<id of the last row>). Admin only, like every /api/updates route:
 * versions and installers are instance administration.
 */
export const GET = adminRoute({ query: VersionHistoryQuerySchema }, async ({ query }) => {
  // The row of the running version, in case the write at server start was cut short.
  await ensureVersionRecorded()
  const page = await listVersionHistory({ cursor: query.cursor, limit: query.limit })
  return NextResponse.json(page, { headers: { 'Cache-Control': 'no-store' } })
})
