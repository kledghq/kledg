/**
 * Database probe of the public health check (app/api/health). Answers a
 * boolean and never throws: the route turns it into 200 or 503 without
 * revealing why the database is unreachable (the reason goes to the log).
 *
 * The route is public (load balancers and platform health checks call it
 * without a session), so a flood of calls must not become a flood of
 * queries or exhaust the pool:
 * - one probe at a time: concurrent calls share the probe in flight;
 * - its answer is reused for PROBE_CACHE_MS, so at most one query per
 *   interval reaches PostgreSQL whatever the request rate;
 * - a probe that takes longer than PROBE_TIMEOUT_MS answers "unreachable",
 *   so a hung database gives a 503 before the platform's own check times
 *   out (Fly.io, Docker and Clever Cloud wait about 5 seconds).
 * It writes nothing (no rate limit counter, no audit row).
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

const PROBE_CACHE_MS = 2_000
const PROBE_TIMEOUT_MS = 4_000

let last: { at: number; ok: boolean } | null = null
let inFlight: Promise<boolean> | null = null

async function probe(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${PROBE_TIMEOUT_MS} ms`)), PROBE_TIMEOUT_MS)
    timer.unref?.()
  })
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout])
    return true
  } catch (error) {
    logger.warn('Health check: database unreachable', error)
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Whether PostgreSQL answers a trivial query (shared and cached, see the module header). */
export async function isDatabaseReachable(now: () => number = Date.now): Promise<boolean> {
  if (last && now() - last.at < PROBE_CACHE_MS) return last.ok
  inFlight ??= probe()
    .then((ok) => {
      last = { at: now(), ok }
      return ok
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Tests start each case without a cached answer. */
export function resetDatabaseProbe(): void {
  last = null
  inFlight = null
}
