/**
 * Input handling of the route wrappers (lib/api/route.ts): the `query` and
 * `body` zod options, their order with authorization, and the `details` of
 * typed errors in the JSON error response.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const state = vi.hoisted(() => ({
  user: { id: 'u-1', email: 'a@test.local', name: null, role: 'user' } as null | { id: string; email: string; name: null; role: string },
  roles: ['accountant'] as string[],
}))

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/companies/slug', () => ({ resolveCompanyRef: async (ref: string) => ref }))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return { ...actual, getUserRolesForCompany: async () => state.roles, isGlobalAdmin: () => false }
})

import { authedRoute, companyRoute, fromQuery, NextResponse } from '@/lib/api/route'
import { ConflictError } from '@/lib/accounting/errors'

const Query = z.object({
  companyId: z.string(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  fiscalYearId: z.string().optional(),
})

const GET = companyRoute(
  { company: fromQuery(), permission: { ledger: ['manage'] }, query: Query },
  async ({ query }) => NextResponse.json(query),
)

beforeEach(() => {
  state.user = { id: 'u-1', email: 'a@test.local', name: null, role: 'user' }
  state.roles = ['accountant']
})

describe('query option', () => {
  it('hands the handler the parsed query', async () => {
    const response = await GET(new NextRequest('http://localhost/api/x?companyId=c-1&limit=20'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ companyId: 'c-1', limit: 20 })
  })

  it('applies defaults', async () => {
    expect(await (await GET(new NextRequest('http://localhost/api/x?companyId=c-1'))).json()).toEqual({ companyId: 'c-1', limit: 10 })
  })

  it('answers 400 with the issue', async () => {
    const response = await GET(new NextRequest('http://localhost/api/x?companyId=c-1&limit=500'))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/^limit: /)
  })

  it('checks the permission before the query: a viewer gets 403, not the 400', async () => {
    state.roles = ['viewer']
    const response = await GET(new NextRequest('http://localhost/api/x?companyId=c-1&limit=500'))
    expect(response.status).toBe(403)
  })

  it('parses the query of authedRoute too', async () => {
    const route = authedRoute({ query: z.object({ q: z.string().min(2) }) }, async ({ query }) => NextResponse.json(query))
    expect((await route(new NextRequest('http://localhost/api/x?q=ab'))).status).toBe(200)
    expect((await route(new NextRequest('http://localhost/api/x?q=a'))).status).toBe(400)
  })
})

describe('body option', () => {
  const post = (body?: string) => new NextRequest('http://localhost/api/x', { method: 'POST', ...(body !== undefined && { body }) })

  it('accepts an empty body when the schema is optional', async () => {
    const route = authedRoute({ body: z.object({ date: z.string().optional() }).optional() }, async ({ body }) =>
      NextResponse.json({ body: body ?? null }),
    )
    expect(await (await route(post())).json()).toEqual({ body: null })
    expect(await (await route(post(''))).json()).toEqual({ body: null })
    expect(await (await route(post('{"date":"2026-01-31"}'))).json()).toEqual({ body: { date: '2026-01-31' } })
    expect((await route(post('{"date":'))).status).toBe(400)
  })

  it('refuses an empty or invalid body when the schema requires one', async () => {
    const route = authedRoute({ body: z.object({ date: z.string() }) }, async ({ body }) => NextResponse.json(body))
    for (const body of [undefined, '', 'not json']) {
      const response = await route(post(body))
      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe('Corps de requête JSON invalide')
    }
    expect((await route(post('{"date":"2026-01-31"}'))).status).toBe(200)
  })
})

describe('error details', () => {
  it('adds the details of a typed error next to its message', async () => {
    const route = authedRoute({}, async () => {
      throw new ConflictError('Clôture impossible').withDetails({ details: ['Brouillons restants'], error: 'ignored' })
    })
    const response = await route(new NextRequest('http://localhost/api/x'))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Clôture impossible', details: ['Brouillons restants'] })
  })

  it('never adds details to unexpected errors', async () => {
    const route = authedRoute({}, async () => {
      throw Object.assign(new Error('secret'), { details: { leak: true } })
    })
    const response = await route(new NextRequest('http://localhost/api/x'))
    expect(response.status).toBe(500)
    expect(Object.keys(await response.json())).toEqual(['error'])
  })
})
