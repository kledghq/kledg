/**
 * Architecture test: every HTTP handler of the app (app/api, but also
 * app/auth and app/.well-known) must be built with a route wrapper from
 * lib/api/route.ts (companyRoute, authedRoute or adminRoute), which
 * authenticates, authorizes and maps errors. A handler written by hand
 * (`export async function GET`) fails this test unless its route is in the
 * allowlist below, with the reason it is public or authenticates itself, or
 * served under a path the instance policy declares self-authenticated
 * (SELF_AUTHENTICATED_API_ROUTES in lib/instance/policy.ts, with its reason).
 * See docs/conventions.md#api-routes.
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { isSelfAuthenticatedApiPath } from '@/lib/instance/api-paths'
import { SELF_AUTHENTICATED_API_ROUTES } from '@/lib/instance/policy'

const APP_DIR = path.resolve(__dirname, '../../../app')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const WRAPPERS = ['companyRoute', 'authedRoute', 'adminRoute']

/** Route directories (relative to app/) that are public or authenticate requests themselves. */
const ALLOWLIST: Record<string, string> = {
  'api/auth/[...all]': 'Better Auth handler: sessions, sign-in, OAuth provider (its own rate limits and hooks, lib/auth.ts)',
  'api/mcp': 'MCP endpoint: API key or OAuth bearer token checked by withMcpUser (lib/mcp/auth.ts)',
  'api/health': 'Public liveness probe, returns no data',
  'api/cron/sync-banks': 'Vercel cron: requires the CRON_SECRET bearer token',
  'api/cron/sync-qonto': 'Former path of the bank sync cron: same handler, CRON_SECRET bearer token',
  'auth/signout': 'Sign out: same-origin POST only (assertSameOrigin), a GET only redirects to the confirmation page',
  '.well-known/openid-configuration/[[...path]]': 'Public OpenID discovery metadata (Better Auth OAuth provider)',
  '.well-known/oauth-authorization-server/[[...path]]': 'Public RFC 8414 authorization server metadata (Better Auth)',
  '.well-known/oauth-protected-resource/[[...path]]': 'Public RFC 9728 metadata of the MCP resource (Better Auth)',
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : routeFiles(full)
    return /^route\.tsx?$/.test(name) ? [full] : []
  })
}

/** Exported HTTP methods and whether each one is `export const X = <wrapper>(`. */
function handlers(source: string): Array<{ method: string; wrapped: boolean }> {
  const found: Array<{ method: string; wrapped: boolean }> = []
  for (const method of METHODS) {
    const wrapped = new RegExp(`export\\s+const\\s+${method}\\s*=\\s*(${WRAPPERS.join('|')})\\s*(<[^>]*>)?\\s*\\(`).test(source)
    const declared =
      wrapped ||
      new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source) ||
      new RegExp(`export\\s+(const|let|var)\\s+${method}\\b`).test(source) ||
      new RegExp(`export\\s+(const|let|var)\\s+\\{[^}]*\\b${method}\\b[^}]*\\}`).test(source) ||
      new RegExp(`export\\s*\\{[^}]*\\bas\\s+${method}\\b[^}]*\\}`).test(source) ||
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`).test(source)
    if (declared) found.push({ method, wrapped })
  }
  return found
}

const files = routeFiles(APP_DIR)
const routeOf = (file: string) => path.relative(APP_DIR, path.dirname(file)).split(path.sep).join('/')

describe('API route architecture', () => {
  it('finds the route files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('wraps every handler with companyRoute, authedRoute or adminRoute', () => {
    const offenders: string[] = []
    for (const file of files) {
      const route = routeOf(file)
      if (route in ALLOWLIST || isSelfAuthenticatedApiPath(`/${route}/`)) continue
      for (const { method, wrapped } of handlers(readFileSync(file, 'utf8'))) {
        if (!wrapped) offenders.push(`${method} /${route}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('declares at least one handler per route file', () => {
    const empty = files.filter((file) => handlers(readFileSync(file, 'utf8')).length === 0).map(routeOf)
    expect(empty).toEqual([])
  })

  it('finds the routes outside app/api', () => {
    expect(files.map(routeOf).filter((route) => !route.startsWith('api/'))).toContain('auth/signout')
  })

  it('keeps the allowlist in sync with existing routes', () => {
    const routes = new Set(files.map(routeOf))
    expect(Object.keys(ALLOWLIST).filter((route) => !routes.has(route))).toEqual([])
  })

  it('gives a reason for every allowlisted route', () => {
    expect(Object.entries(ALLOWLIST).filter(([, reason]) => reason.trim().length < 20).map(([route]) => route)).toEqual([])
  })

  it('gives a reason for every self-authenticated path of the instance policy', () => {
    const invalid = Object.entries(SELF_AUTHENTICATED_API_ROUTES)
      .filter(([prefix, reason]) => !prefix.startsWith('/api/') || reason.trim().length < 20)
      .map(([prefix]) => prefix)
    expect(invalid).toEqual([])
  })

  it('never uses the removed requireCompanyAccessIfPresent helper', () => {
    const users = files.filter((file) => readFileSync(file, 'utf8').includes('requireCompanyAccessIfPresent'))
    expect(users.map(routeOf)).toEqual([])
  })
})
