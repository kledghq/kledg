import { adminRoute, NextResponse } from '@/lib/api/route'
import { getUpdateOverview } from '@/lib/updates/overview'
import { UpdateOverviewQuerySchema } from '@/lib/updates/overview-query'

export const dynamic = 'force-dynamic'

/**
 * Running version, latest Kledg release, notes and migrations of the update,
 * GitHub connection summary (never the token). ?light=1 for the header
 * indicator (no migrations, no connection).
 */
export const GET = adminRoute({ query: UpdateOverviewQuerySchema }, async ({ query, user }) => {
  const overview = await getUpdateOverview({ light: query.light, actor: user })
  return NextResponse.json(overview, { headers: { 'Cache-Control': 'no-store' } })
})
