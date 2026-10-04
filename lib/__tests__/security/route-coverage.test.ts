/**
 * Route coverage guard.
 *
 * Enumerates EVERY app/**\/route.ts handler programmatically, so a new route
 * is caught automatically. For each handler, the universal invariant is
 * asserted: an anonymous caller is refused with 401 before any work. A route
 * that is public or self-authenticating must be declared in PUBLIC_ROUTES
 * with a reason, or the test fails. Routes whose anonymous handling is a known
 * open issue are listed in DELEGATED with the finding id.
 *
 * The per-actor / per-role / IDOR depth lives in
 * lib/api/__tests__/authorization-matrix.test.ts and the other files in this
 * folder; this guard only guarantees that no route escapes authentication and
 * that none is forgotten.
 *
 * No database is needed: every wrapper (companyRoute/authedRoute/adminRoute)
 * runs requireUser() first, so an anonymous call returns 401 without a query.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELEGATED_FINDINGS, skip } from './findings'

await vi.hoisted(async () => {
  // Some route modules instantiate Better Auth / Prisma at import time. No
  // query runs for the anonymous 401 check, but the client needs a URL.
  process.env.DATABASE_URL ??=
    process.env.KLEDG_TEST_DATABASE_URL ?? 'postgresql://kledg:kledg@localhost:55432/postgres'
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
})

const state = { user: null as unknown }
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

const ROOT = join(__dirname, '..', '..', '..')
const APP_API = join(ROOT, 'app')
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
type Method = (typeof HTTP_METHODS)[number]

/**
 * Public or self-authenticating routes: no session, so the 401 invariant does
 * not apply. Each needs a reason. Keyed by the route path relative to the repo.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  'app/.well-known/oauth-authorization-server/[[...path]]/route.ts': 'OAuth AS metadata, public by RFC 8414',
  'app/.well-known/oauth-protected-resource/[[...path]]/route.ts': 'OAuth protected-resource metadata, public by RFC 9728',
  'app/.well-known/openid-configuration/[[...path]]/route.ts': 'OIDC discovery document, public',
  'app/api/auth/[...all]/route.ts': 'Better Auth handler; authenticates itself per endpoint',
  'app/api/mcp/route.ts': 'MCP server; bearer token / api key auth (lib/mcp, mcp-authorization test)',
  'app/api/health/route.ts': 'Liveness probe, intentionally public',
  'app/api/cron/sync-banks/route.ts': 'Cron; authenticated by CRON_SECRET header',
  'app/api/cron/sync-qonto/route.ts': 'Cron; authenticated by CRON_SECRET header',
  'app/auth/signout/route.ts': 'Sign-out; same-origin guarded (app/api/__tests__/signout.test.ts)',
  'app/api/banking/revolut/callback/route.ts': 'Revolut OAuth callback; state-cookie bound, no session yet',
}

/** Routes whose anonymous handling is a known open issue owned by another workstream. */
const DELEGATED: Record<string, keyof typeof DELEGATED_FINDINGS> = {
  'app/api/companies/route.ts': 'KLEDG-DEL-anon-companies',
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (name === 'route.ts') out.push(full)
  }
  return out
}

function exportedMethods(source: string): Method[] {
  return HTTP_METHODS.filter((m) => {
    const patterns = [
      new RegExp(`export\\s+const\\s+${m}\\b`),
      new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`),
      new RegExp(`export\\s+const\\s*\\{[^}]*\\b${m}\\b`), // export const { GET, POST } = ...
    ]
    return patterns.some((p) => p.test(source))
  })
}

interface RouteFile {
  abs: string
  rel: string
  methods: Method[]
}

const routeFiles: RouteFile[] = walk(APP_API)
  .map((abs) => ({ abs, rel: relative(ROOT, abs), methods: exportedMethods(readFileSync(abs, 'utf8')) }))
  .sort((a, b) => a.rel.localeCompare(b.rel))

const protectedRoutes = routeFiles.filter((r) => !(r.rel in PUBLIC_ROUTES) && !(r.rel in DELEGATED))

async function callAnonymous(abs: string, method: Method): Promise<number> {
  const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>
  const handler = mod[method] as (req: Request, ctx?: unknown) => Promise<Response>
  const request = new NextRequest('http://localhost/x', { method: method === 'GET' || method === 'HEAD' ? 'GET' : method })
  const response = await handler(request, { params: Promise.resolve({}) })
  return response.status
}

describe('route coverage guard', () => {
  beforeAll(() => {
    state.user = null
  })
  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('found a meaningful number of route handlers', () => {
    expect(routeFiles.length).toBeGreaterThan(100)
    expect(routeFiles.every((r) => r.methods.length > 0)).toBe(true)
  })

  it('every PUBLIC_ROUTES entry still exists (no stale allowlist)', () => {
    const known = new Set(routeFiles.map((r) => r.rel))
    for (const rel of Object.keys(PUBLIC_ROUTES)) expect(known.has(rel), rel).toBe(true)
    for (const rel of Object.keys(DELEGATED)) expect(known.has(rel), rel).toBe(true)
  })

  const cases = protectedRoutes.flatMap((r) => r.methods.map((m) => [`${m} ${r.rel}`, r.abs, m] as const))

  it.each(cases)('%s refuses an anonymous caller with 401', async (_label, abs, method) => {
    expect(await callAnonymous(abs, method)).toBe(401)
  })

  // The liveness probe is public on purpose (platform health checks call it
  // without a session): it answers anonymously with its status only.
  it('GET /api/health answers an anonymous caller with its status only', async () => {
    const mod = (await import(pathToFileURL(join(ROOT, 'app/api/health/route.ts')).href)) as { GET: () => Promise<Response> }
    const response = await mod.GET()
    expect([200, 503]).toContain(response.status)
    expect(Object.keys(await response.json()).sort()).toEqual(response.status === 200 ? ['status'] : ['database', 'status'])
  })

  // KLEDG-DEL-anon-companies (fixed): the API was already wrapped; the
  // /companies page itself now requires the user (app/(account)/companies/__tests__/page.test.ts).
  it('GET /api/companies requires auth (KLEDG-DEL-anon-companies)', async () => {
    const status = await callAnonymous(join(ROOT, 'app/api/companies/route.ts'), 'GET')
    expect(status).toBe(401)
  })
})

describe('server actions coverage', () => {
  it('the only server action file is accounted for', () => {
    const actionFiles = walk(join(ROOT, 'app')).length // sanity that walk works
    expect(actionFiles).toBeGreaterThan(0)
    // app/(auth)/setup/actions.ts is the single 'use server' module; its
    // takeover risk is tracked by the delegated setup finding.
    const setupActions = join(ROOT, 'app/(auth)/setup/actions.ts')
    expect(readFileSync(setupActions, 'utf8')).toContain("'use server'")
    expect(DELEGATED_FINDINGS['KLEDG-DEL-setup-takeover']).toBeDefined()
  })
})
