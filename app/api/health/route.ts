import { isDatabaseReachable } from '@/lib/health/check-database.service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Liveness and database check for load balancers and platform health checks
 * (Railway, Render, Fly.io, Clever Cloud, Docker HEALTHCHECK, Coolify).
 * Public: no session, no version, no detail; proxy.ts lets it through.
 */
export async function GET() {
  if (await isDatabaseReachable()) {
    return Response.json({ status: 'ok' }, { headers: NO_STORE })
  }
  return Response.json({ status: 'error', database: 'unreachable' }, { status: 503, headers: NO_STORE })
}
