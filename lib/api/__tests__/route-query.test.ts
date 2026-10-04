/**
 * The `query` option of the route wrappers: the query string is parsed by a
 * zod schema before the handler runs, an invalid one is a 400.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { z } from 'zod'

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.local', name: null, role: null }),
}))

vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return { ...actual, getUserRolesForCompany: vi.fn().mockResolvedValue(['viewer']), isGlobalAdmin: vi.fn().mockReturnValue(false) }
})

vi.mock('@/lib/companies/slug', () => ({ resolveCompanyRef: vi.fn(async (ref: string) => ref) }))

import { authedRoute, companyRoute, fromQuery, NextResponse } from '@/lib/api/route'

const Schema = z.object({
  fiscalYearId: z.string().optional(),
  variant: z.enum(['complete', 'simplified'], { error: 'Variante inconnue' }).default('complete'),
})

describe('route wrappers: query option', () => {
  const seen = vi.fn()
  const GET = companyRoute(
    { company: fromQuery(), permission: { reports: ['read'] }, query: Schema },
    async ({ query, companyId }) => {
      seen(query, companyId)
      return NextResponse.json({ ok: true })
    },
  )

  beforeEach(() => seen.mockClear())

  it('hands the parsed query to the handler, defaults applied', async () => {
    const response = await GET(new NextRequest('http://localhost/api/x?companyId=c-1&fiscalYearId=fy-1&other=1'))
    expect(response.status).toBe(200)
    expect(seen).toHaveBeenCalledWith({ fiscalYearId: 'fy-1', variant: 'complete' }, 'c-1')
  })

  it('treats an empty parameter as absent', async () => {
    await GET(new NextRequest('http://localhost/api/x?companyId=c-1&fiscalYearId=&variant='))
    expect(seen).toHaveBeenCalledWith({ variant: 'complete' }, 'c-1')
  })

  it('answers 400 with the schema message on an invalid query, before the handler', async () => {
    const response = await GET(new NextRequest('http://localhost/api/x?companyId=c-1&variant=other'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'variant: Variante inconnue' })
    expect(seen).not.toHaveBeenCalled()
  })

  it('authorizes before reading the query: anonymous is a 401, not a 400', async () => {
    const { getCurrentUser } = await import('@/lib/session')
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null)
    const response = await GET(new NextRequest('http://localhost/api/x?companyId=c-1&variant=other'))
    expect(response.status).toBe(401)
  })

  it('is supported by authedRoute', async () => {
    const handler = authedRoute({ query: Schema }, async ({ query }) => NextResponse.json(query))
    const response = await handler(new NextRequest('http://localhost/api/x?variant=simplified'))
    expect(await response.json()).toEqual({ variant: 'simplified' })
  })
})
