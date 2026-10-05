/**
 * Guard of the owner's rule: every action a user can do in Kledg can be
 * done through the MCP server (lib/mcp/route-coverage.ts).
 *
 * - every handler of app/api (each exported method of each route.ts) has an
 *   entry: MCP tools, or a written reason to stay out of the server. A new
 *   route without either fails here;
 * - no entry is left for a handler that is gone;
 * - every tool named exists (registered with full control, which registers
 *   every level), and a handler that changes data maps to at least one tool
 *   that writes (except the POST routes that only compute);
 * - the inventory of docs/mcp.md lists every handler.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { EXCLUSIONS, ROUTE_COVERAGE } from '@/lib/mcp/route-coverage'
import { INSTANCE_ROUTE_COVERAGE } from '@/lib/instance/route-coverage'

const ROOT = path.resolve(__dirname, '../../..')
const API = path.join(ROOT, 'app/api')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** POST handlers that compute without writing: their tools are read tools. */
const READ_ONLY_POSTS = new Set(['POST /api/transaction-rules/simulate', 'POST /api/transaction-rules/[id]/simulate'])

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === '__tests__') return []
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? routeFiles(full) : name === 'route.ts' ? [full] : []
  })
}

/** Exported HTTP methods of a route module (wrapped, hand written or re-exported). */
function methodsOf(source: string): string[] {
  return METHODS.filter(
    (method) =>
      new RegExp(`export\\s+const\\s+${method}\\s*=`).test(source) ||
      new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source) ||
      new RegExp(`export\\s+const\\s+\\{[^}]*\\b${method}\\b[^}]*\\}`).test(source) ||
      new RegExp(`export\\s*\\{[^}]*\\b(as\\s+)?${method}\\b[^}]*\\}`).test(source),
  )
}

const HANDLERS = routeFiles(API).flatMap((file) => {
  const route = `/api/${path.relative(API, path.dirname(file)).split(path.sep).join('/')}`.replace(/\/$/, '')
  return methodsOf(readFileSync(file, 'utf8')).map((method) => `${method} ${route}`)
})

type Config = { annotations?: { readOnlyHint?: boolean } }

function registeredTools(): Map<string, Config> {
  const tools = new Map<string, Config>()
  const user = { id: 'u1', email: 'a@b.c', name: null, role: 'user' }
  registerKledgTools({ registerTool: (name: string, config: Config) => tools.set(name, config) } as never, {
    user,
    caller: { kind: 'apiKey', apiKeyId: 'k1' },
    canWrite: true,
    canAdmin: true,
    executionMode: 'validation',
  })
  return tools
}

describe('MCP coverage of the API routes', () => {
  const tools = registeredTools()

  it('finds the route handlers', () => {
    expect(HANDLERS.length).toBeGreaterThan(300)
    expect(HANDLERS).toContain('POST /api/entries')
    expect(HANDLERS).toContain('POST /api/mcp')
  })

  it('maps every route handler to MCP tools or to a written exclusion', () => {
    const missing = HANDLERS.filter((handler) => !(handler in ROUTE_COVERAGE) && !(handler in INSTANCE_ROUTE_COVERAGE))
    expect(
      missing,
      'Add these handlers to lib/mcp/route-coverage.ts (or, for a route of the instance, lib/instance/route-coverage.ts): an MCP tool doing the same, or an exclusion with its reason',
    ).toEqual([])
  })

  it('keeps no entry for a handler that is gone', () => {
    const stale = [...Object.keys(ROUTE_COVERAGE), ...Object.keys(INSTANCE_ROUTE_COVERAGE)].filter((key) => !HANDLERS.includes(key))
    expect(stale).toEqual([])
  })

  it('checks the routes the instance declares: existing tools, or a French reason without dashes', () => {
    for (const [handler, coverage] of Object.entries(INSTANCE_ROUTE_COVERAGE)) {
      expect(handler in ROUTE_COVERAGE, `${handler} is already mapped by Kledg`).toBe(false)
      if ('tools' in coverage) {
        expect(coverage.tools.length, handler).toBeGreaterThan(0)
        for (const tool of coverage.tools) expect(tools.has(tool), `${handler}: ${tool}`).toBe(true)
      } else {
        expect(coverage.excluded.length, handler).toBeGreaterThan(20)
        expect(coverage.excluded, handler).not.toMatch(/[–—]/)
      }
    }
  })

  it('names only tools that exist, and a writing tool for each handler that changes data', () => {
    for (const [handler, coverage] of Object.entries(ROUTE_COVERAGE)) {
      if (!('tools' in coverage)) continue
      expect(coverage.tools.length, handler).toBeGreaterThan(0)
      for (const tool of coverage.tools) expect(tools.has(tool), `${handler}: ${tool}`).toBe(true)
      if (handler.startsWith('GET ') || READ_ONLY_POSTS.has(handler)) continue
      const writes = coverage.tools.some((tool) => tools.get(tool)?.annotations?.readOnlyHint === false)
      expect(writes, `${handler} changes data: map it to a tool that writes`).toBe(true)
    }
  })

  it('gives every exclusion a French reason without dashes', () => {
    for (const [handler, coverage] of Object.entries(ROUTE_COVERAGE)) {
      if ('excluded' in coverage) expect(EXCLUSIONS[coverage.excluded], handler).toBeTruthy()
    }
    for (const reason of Object.values(EXCLUSIONS)) {
      expect(reason.length).toBeGreaterThan(20)
      expect(reason).not.toMatch(/[–—]/)
    }
  })

  it('lists every handler in the inventory of docs/mcp.md', () => {
    const docs = readFileSync(path.join(ROOT, 'docs/mcp.md'), 'utf8')
    const missing = Object.keys(ROUTE_COVERAGE).filter((handler) => !docs.includes(`\`${handler}\``))
    expect(missing, 'Regenerate the inventory of docs/mcp.md').toEqual([])
  })
})
