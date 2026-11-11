/**
 * Hardening of the MCP endpoint and of the approved actions, without a
 * database:
 * - an approved action that targets an entry locks the entry lines of that
 *   company only (lib/approved-state/targets.ts);
 * - /api/mcp caps its request body like the wrapped routes
 *   (lib/api/request-guards.ts), before authentication: 413 beyond, the
 *   handler never runs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  // Modules of the route read it when they load; nothing connects in this file.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/unused'
  return { handled: 0 }
})

vi.mock('@/lib/mcp/auth', () => ({
  withMcpUser: () => async () => {
    state.handled++
    return Response.json({ ok: true })
  },
}))

import { loadTargetState, type Db } from '@/lib/approved-state/targets'

/** A client that records the SQL of every raw query and answers no row. */
function recordingDb() {
  const queries: string[] = []
  const db = {
    $queryRaw: async (strings: TemplateStringsArray | { strings: readonly string[] }) => {
      const parts = 'raw' in (strings as TemplateStringsArray) ? (strings as TemplateStringsArray) : (strings as { strings: readonly string[] }).strings
      queries.push(parts.join('?'))
      return []
    },
    accountingEntry: { findFirst: async () => null },
  }
  return { db: db as unknown as Db, queries }
}

describe('approved entry targets', () => {
  it('locks the lines of the entry within its company only', async () => {
    const { db, queries } = recordingDb()
    await loadTargetState(db, { kind: 'entry', companyId: 'company-a', id: 'entry-of-b' }, { lock: true })
    const lines = queries.filter((q) => q.includes('"entry_lines"'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/"companyId" = \?/)
  })
})

describe('/api/mcp request body', () => {
  let POST: (request: Request) => Promise<Response>

  beforeEach(async () => {
    state.handled = 0
    ;({ POST } = (await import('@/app/api/mcp/route')) as unknown as { POST: (request: Request) => Promise<Response> })
  })

  const rpc = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
      duplex: 'half',
    } as RequestInit)

  it('refuses a body over the cap announced by Content-Length', async () => {
    const response = await POST(rpc('{}', { 'content-length': String(64 * 1024 * 1024) }))
    expect(response.status).toBe(413)
    expect(state.handled).toBe(0)
  })

  it('refuses a streamed body that grows past the cap', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 20) return controller.close()
        sent++
        controller.enqueue(chunk)
      },
    })
    const response = await POST(rpc(stream))
    expect(response.status).toBe(413)
    expect(((await response.json()) as { error: string }).error).toMatch(/Requête trop volumineuse/)
    expect(state.handled).toBe(0)
    // Reading stopped at the cap, not at the end of the stream
    expect(sent).toBeLessThan(20)
  })

  it('passes a normal call through, its body intact', async () => {
    const response = await POST(rpc(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })))
    expect(response.status).toBe(200)
    expect(state.handled).toBe(1)
  })
})
