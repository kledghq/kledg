/**
 * Input validation of the route wrappers (lib/api/route.ts) for companyRoute
 * and authedRoute: the `body` and `query` zod options answer 400 with the
 * issues (French zod messages) before the handler runs, and hand the
 * handler the parsed values. Session and roles are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const state = vi.hoisted(() => ({
  user: { id: 'u-1', email: 'a@test.local', name: 'A', role: 'user' } as null | { id: string; email: string; name: string; role: string },
  roles: ['accountant'] as string[],
}))

// Archived companies are read-only (lib/companies/archive-company.service.ts): none here.
vi.mock('@/lib/companies/archive-company.service', () => ({ assertCompanyWritable: async () => undefined }))
vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => state.user) }))
vi.mock('@/lib/companies/slug', () => ({ resolveCompanyRef: vi.fn(async (ref: string) => (ref === 'acme' ? 'c-acme' : null)) }))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return { ...actual, getUserRolesForCompany: vi.fn(async () => state.roles) }
})

import { authedRoute, companyRoute, fromQuery } from '@/lib/api/route'

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().optional(),
})

const Body = z.object({ name: z.string().min(1) })

function request(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

beforeEach(() => {
  state.user = { id: 'u-1', email: 'a@test.local', name: 'A', role: 'user' }
  state.roles = ['accountant']
})

describe('query option', () => {
  const handler = vi.fn(async ({ query }: { query: z.infer<typeof Query> }) => Response.json(query))
  const GET = authedRoute({ query: Query }, handler)

  it('hands the handler the parsed and defaulted query', async () => {
    const response = await GET(request('/api/x?search=%20dupont%20'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ limit: 20, search: 'dupont' })
  })

  it('coerces numbers from the query string', async () => {
    expect(await (await GET(request('/api/x?limit=5'))).json()).toEqual({ limit: 5 })
  })

  it('answers 400 with the parameter name, before the handler runs', async () => {
    handler.mockClear()
    const response = await GET(request('/api/x?limit=500'))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/^limit: /)
    expect(handler).not.toHaveBeenCalled()
  })

  it('still answers 401 first for an anonymous user', async () => {
    state.user = null
    expect((await GET(request('/api/x?limit=500'))).status).toBe(401)
  })

  it('leaves query undefined without a schema', async () => {
    const plain = authedRoute({}, async ({ query }) => Response.json({ query: query ?? null }))
    expect(await (await plain(request('/api/x?limit=5'))).json()).toEqual({ query: null })
  })
})

describe('companyRoute with query and body', () => {
  const POST = companyRoute(
    { company: fromQuery(), permission: { ledger: ['manage'] }, query: Query, body: Body },
    async ({ companyId, query, body }) => Response.json({ companyId, query, body }),
  )

  it('resolves the company, then parses the query (company parameter ignored) and the body', async () => {
    const response = await POST(request('/api/x?companyId=acme&limit=3', 'POST', { name: 'Règle' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ companyId: 'c-acme', query: { limit: 3 }, body: { name: 'Règle' } })
  })

  it('checks the permission before validating the input', async () => {
    state.roles = ['viewer']
    expect((await POST(request('/api/x?companyId=acme&limit=0', 'POST', {}))).status).toBe(403)
  })

  it('answers 404 for an unknown company before validating the input', async () => {
    expect((await POST(request('/api/x?companyId=other&limit=0', 'POST', {}))).status).toBe(404)
  })

  it('reports the default zod messages in French', async () => {
    const response = await POST(request('/api/x?companyId=acme', 'POST', {}))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('name: Entrée invalide : string attendu, undefined reçu')
  })

  it('reads an empty body as undefined and refuses malformed JSON', async () => {
    const Optional = companyRoute(
      { company: fromQuery(), permission: { ledger: ['manage'] }, body: Body.optional().default({ name: 'défaut' }) },
      async ({ body }) => Response.json(body),
    )
    expect(await (await Optional(request('/api/x?companyId=acme', 'POST'))).json()).toEqual({ name: 'défaut' })
    const malformed = await Optional(
      new NextRequest('http://localhost/api/x?companyId=acme', { method: 'POST', body: '{"name":', headers: { 'content-type': 'application/json' } }),
    )
    expect(malformed.status).toBe(400)
    expect((await malformed.json()).error).toBe('Corps de requête JSON invalide')
  })

  it('answers 400 on an invalid body', async () => {
    const response = await POST(request('/api/x?companyId=acme', 'POST', { name: '' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/^name: /)
  })
})
