import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool, type PoolConfig } from 'pg'
import { attachDatabasePool } from '@vercel/functions/db-connections'
import { logger } from './logger'
import { isTransientConnectError } from './transient-db-error'
import { currentRlsContext } from './rls/context'
import { assertRequiredRlsMode, rlsMode } from './rls/mode'
import { requiresRowLevelSecurity } from './instance/policy'
import { enforceRlsOnPool } from './rls/pool'
import { createRequestContextResolver } from './rls/request-context'
import { verifyAppRole } from './rls/app-role'
import { isolatePrismaBatches } from './rls/batching'

/**
 * Prisma client over node-postgres, so Kledg runs on any PostgreSQL:
 * Neon (the Vercel starter pack), Supabase, RDS, or a local container.
 *
 * DATABASE_URL is the pooled connection used at runtime. The Neon Vercel
 * integration, Render (fromDatabase), Railway (${{Postgres.DATABASE_URL}})
 * and `fly postgres attach` set it; POSTGRES_URL and POSTGRES_PRISMA_URL are
 * accepted as fallbacks, and POSTGRESQL_ADDON_URI, the variable the Clever
 * Cloud PostgreSQL add-on injects into the applications linked to it.
 *
 * KLEDG_DATABASE_URL, when set, comes first: the application role of
 * KLEDG_RLS=enforce (docs/rls.md), set next to the DATABASE_URL a host
 * integration manages (Neon on Vercel), which keeps the owner's URL.
 */
export function databaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.KLEDG_DATABASE_URL || env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL || env.POSTGRESQL_ADDON_URI || undefined
}

function getConnectionString(): string {
  const url = databaseUrl()
  // `next build` imports route modules (and Better Auth, which reads the Prisma
  // data model) without needing a database: node-postgres only connects on the
  // first query, so a placeholder is enough there (e.g. Docker builds).
  if (!url && process.env.NEXT_PHASE === 'phase-production-build') {
    return 'postgresql://build:build@localhost:5432/build'
  }
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
  }
  return url
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres', 'host.docker.internal'])

/**
 * Host names of private networks that hosts encrypt themselves (WireGuard):
 * Railway (`postgres.railway.internal`) and Fly.io (`<app>.flycast`). Fly
 * Postgres does not offer TLS there; `fly postgres attach` URLs often say
 * sslmode=disable, not always.
 */
const PRIVATE_SUFFIXES = ['.railway.internal', '.flycast']

/**
 * Fly.io's `<app>.internal` names, only when running on Fly (FLY_APP_NAME):
 * elsewhere `.internal` is any private DNS zone (`db.corp.internal`), whose
 * network nothing says is encrypted.
 */
const FLY_PRIVATE_SUFFIX = '.internal'

/**
 * TLS settings. DATABASE_SSL=false or `sslmode=disable` in the URL turn TLS off;
 * DATABASE_SSL=true or `sslmode=require` (verify-ca, verify-full) force it.
 * Without either, no TLS for:
 * - local hosts and Docker service names (`db`, `postgres`);
 * - single-label host names, which only private DNS resolves (Docker Compose
 *   services on Coolify and Dokploy, Render's internal URL `dpg-...-a`);
 * - the private networks of PRIVATE_SUFFIXES, and Fly's `.internal` on Fly.
 * Everything else (Neon, Render's external URL, Clever Cloud, Supabase, RDS)
 * uses TLS. Certificates are not verified (managed hosts use their own CAs);
 * TLS still encrypts the traffic on the public network.
 */
export function sslConfig(url: string, env: Record<string, string | undefined> = process.env): PoolConfig['ssl'] {
  if (env.DATABASE_SSL === 'false' || /sslmode=disable/.test(url)) return false
  if (env.DATABASE_SSL === 'true' || /sslmode=(require|verify-ca|verify-full)/.test(url)) return { rejectUnauthorized: false }
  const host = new URL(url).hostname.toLowerCase()
  if (LOCAL_HOSTS.has(host) || !host.includes('.') || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false
  if (env.FLY_APP_NAME && host.endsWith(FLY_PRIVATE_SUFFIX)) return false
  return { rejectUnauthorized: false }
}

export { isTransientConnectError }

/**
 * Retries a failed connection attempt once. Only the connect step is retried,
 * never a query, so no statement can run twice.
 */
export function retryConnectOnce(pool: Pool): void {
  const connect = pool.connect.bind(pool) as () => Promise<import('pg').PoolClient>
  const withRetry = async () => {
    try {
      return await connect()
    } catch (error) {
      if (!isTransientConnectError(error)) throw error
      logger.warn('Postgres connection failed, retrying once:', (error as Error).message)
      return connect()
    }
  }
  pool.connect = ((callback?: (err: Error | undefined, client?: unknown, release?: unknown) => void) => {
    if (typeof callback === 'function') {
      // Callback form, used by pool.query (most Prisma queries go through it).
      withRetry().then(
        (client) => callback(undefined, client, (err?: Error | boolean) => client.release(err)),
        (error: Error) => callback(error),
      )
      return
    }
    return withRetry()
  }) as Pool['connect']
}

function positiveInt(value: string | undefined): number | undefined {
  const n = value ? Number(value) : NaN
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/**
 * Pool size and idle timeout, per runtime (DATABASE_POOL_MAX and
 * DATABASE_POOL_IDLE_TIMEOUT_MS override them):
 * - Vercel (Fluid Compute): one instance serves concurrent requests, behind
 *   Neon's pooled URL (PgBouncer, which multiplexes thousands of client
 *   connections). 10 connections per instance; idle connections closed after
 *   5 seconds, so a suspended instance does not hold server connections for
 *   long, while requests a few seconds apart reuse a warm connection (a new
 *   TLS connection to Neon costs a round trip or more).
 * - Long running server (Docker, `next start`): same size, idle connections
 *   kept 30 seconds (no suspension; reconnecting is pure overhead).
 */
export function poolSizing(env: Record<string, string | undefined> = process.env): Pick<PoolConfig, 'max' | 'idleTimeoutMillis'> {
  return {
    max: positiveInt(env.DATABASE_POOL_MAX) ?? 10,
    idleTimeoutMillis: positiveInt(env.DATABASE_POOL_IDLE_TIMEOUT_MS) ?? (env.VERCEL ? 5_000 : 30_000),
  }
}

/**
 * On Vercel (Fluid compute) an instance can be suspended as soon as its
 * last response is sent, with idle clients still open: their server
 * connections then stay open until Neon or PgBouncer drops them. Vercel's
 * attachDatabasePool keeps the instance alive until the pool's idle timeout
 * has closed them (it extends the request with waitUntil after each client
 * release). Anywhere else (Docker, `next start`, tests) the process keeps
 * running and nothing is attached.
 *
 * Dependency: @vercel/functions (Apache-2.0, maintained by Vercel; the
 * db-connections entry point is a few kilobytes, server only). It replaces
 * reaching into Vercel's private request context for waitUntil ourselves.
 */
export function attachPoolToPlatform(
  pool: Pool,
  env: Record<string, string | undefined> = process.env,
  attach: (pool: Pool) => void = attachDatabasePool,
): boolean {
  if (!env.VERCEL) return false
  attach(pool)
  return true
}

function createPrismaClient(): PrismaClient {
  const url = getConnectionString()
  // node-postgres doesn't parse these query params; SSL is configured explicitly.
  const connectionString = url
    .replace(/([?&])(sslmode|channel_binding)=[^&]*/g, '$1')
    .replace(/[?&]+$/, '')
    .replace(/\?&/, '?')

  const pool = new Pool({
    connectionString,
    ssl: sslConfig(url),
    ...poolSizing(),
    // Neon and other scale-to-zero databases take a few seconds to wake up:
    // a short timeout turns the first request after a pause into an error.
    connectionTimeoutMillis: 15000,
    // TCP keepalive on idle connections: a long running server (Docker,
    // Railway, Render, Fly.io, Clever Cloud) keeps them for the idle timeout,
    // and what sits in between (Fly.io flycast, the Clever Cloud database
    // proxy, NAT) may drop a silent connection.
    keepAlive: true,
    allowExitOnIdle: true,
  })
  // An idle client dropped by the server (compute suspended, network blip)
  // emits 'error' on the pool; without a listener Node treats it as fatal.
  pool.on('error', (error) => logger.warn('Postgres pool client error:', error.message))
  retryConnectOnce(pool)
  attachPoolToPlatform(pool)
  // Row level security (docs/rls.md): every statement carries the context of
  // its request. Off by default; KLEDG_RLS=enforce needs the application role.
  assertRequiredRlsMode(requiresRowLevelSecurity())
  const enforce = rlsMode() === 'enforce'
  if (enforce) {
    // A statement without a context in a Next request (server components,
    // server actions) runs as the user of the request's session cookie.
    const derive = createRequestContextResolver(async (token) => {
      const { rows } = await pool.query<{ userId: string }>(
        `SELECT "userId" FROM "session" WHERE "token" = $1 AND "expiresAt" > (now() AT TIME ZONE 'UTC')`,
        [token],
      )
      return rows[0]?.userId
    })
    enforceRlsOnPool(pool, { capture: currentRlsContext, derive, verify: verifyAppRole })
  }

  const client = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: [
      { emit: 'event', level: 'error' },
      ...(process.env.NODE_ENV === 'development' ? [{ emit: 'event' as const, level: 'warn' as const }] : []),
    ],
  })

  type PrismaLogEvent = { message?: string; target?: string }
  client.$on('error' as never, (e: PrismaLogEvent) => {
    if (e?.message) logger.error('Prisma error:', e.message, e.target)
  })
  client.$on('warn' as never, (e: PrismaLogEvent) => {
    if (e?.message) logger.warn('Prisma warning:', e.message, e.target)
  })

  if (enforce) isolatePrismaBatches(client)
  return client
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/**
 * Lazily created on first use, so importing this module during `next build`
 * doesn't require database credentials.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    globalForPrisma.prisma ??= createPrismaClient()
    const value = Reflect.get(globalForPrisma.prisma, property)
    return typeof value === 'function' ? value.bind(globalForPrisma.prisma) : value
  },
})
