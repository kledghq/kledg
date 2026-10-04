/**
 * Chart colour preferences (GET and PUT /api/account/appearance). The
 * database, the session, the rate limit and the instance policy are mocked:
 * the tests check authentication, that every query is keyed by the session
 * user (own preferences only), validation, the same-origin guard, the body
 * cap, the rate limit and the policy. The real-database version is in the
 * authorization matrix (lib/api/__tests__/authorization-matrix.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type User = { id: string; email: string; name: string | null; role: string | null }

const state = vi.hoisted(() => ({ user: null as null | User, refused: new Set<string>() }))

vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => state.user) }))
// The real policy (every hook and constant of the extension point), with the two refusals replaced.
vi.mock('@/lib/instance/policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instance/policy')>()),
  isActionAllowed: vi.fn(async (action: string) => !state.refused.has(action)),
  actionRefusalMessage: vi.fn(() => 'Refusé par la politique de cette instance.'),
}))
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => {}) }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { enforceRateLimit } from '@/lib/rate-limit'
import { RateLimitError } from '@/lib/accounting/errors'
import { GET, PUT } from '../account/appearance/route'

const db = asPrismaMock(prisma)
const MARIE: User = { id: 'u-marie', email: 'marie@acme.fr', name: 'Marie', role: 'user' }

function call(handler: typeof GET, method: string, body?: unknown, headers: Record<string, string> = {}) {
  const request = new NextRequest('http://localhost:3000/api/account/appearance', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  return handler(request, { params: Promise.resolve({}) })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = MARIE
  state.refused = new Set()
  db.userPreference.findUnique.mockResolvedValue(null)
  db.userPreference.upsert.mockResolvedValue({})
})

describe('signed out', () => {
  it('answers 401 to GET and PUT without touching the database', async () => {
    state.user = null
    expect((await call(GET, 'GET')).status).toBe(401)
    expect((await call(PUT, 'PUT', { palette: 'pastel' })).status).toBe(401)
    expect(db.userPreference.findUnique).not.toHaveBeenCalled()
    expect(db.userPreference.upsert).not.toHaveBeenCalled()
  })
})

describe('GET', () => {
  it('returns the defaults when the user never saved colours', async () => {
    const response = await call(GET, 'GET')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({
      appearance: { palette: 'sobre', base: 'sobre', custom: { light: {}, dark: {} } },
      isDefault: true,
      canChange: true,
      refusal: null,
    })
    expect(db.userPreference.findUnique).toHaveBeenCalledWith({ where: { userId: MARIE.id }, select: { appearance: true } })
  })

  it("reads the session user's row only", async () => {
    db.userPreference.findUnique.mockResolvedValue({ appearance: { version: 1, palette: 'pastel', base: 'pastel', custom: { light: {}, dark: {} } } })
    const body = (await (await call(GET, 'GET')).json()) as { appearance: { palette: string }; isDefault: boolean }
    expect(body.appearance.palette).toBe('pastel')
    expect(body.isDefault).toBe(false)
    expect(db.userPreference.findUnique.mock.calls.every(([args]) => args.where.userId === MARIE.id)).toBe(true)
  })

  it('reads an invalid stored row as the defaults', async () => {
    db.userPreference.findUnique.mockResolvedValue({ appearance: { version: 1, palette: 'custom', custom: { light: { revenue: 'red' } } } })
    const body = (await (await call(GET, 'GET')).json()) as { appearance: { palette: string } }
    expect(body.appearance.palette).toBe('sobre')
  })

  it('says when the instance refuses changes', async () => {
    state.refused.add('change-appearance')
    const body = (await (await call(GET, 'GET')).json()) as { canChange: boolean; refusal: string }
    expect(body).toMatchObject({ canChange: false, refusal: 'Refusé par la politique de cette instance.' })
  })
})

describe('PUT', () => {
  it('saves a custom palette for the session user, normalized, with its format version', async () => {
    const response = await call(PUT, 'PUT', { palette: 'custom', base: 'daltonisme', custom: { light: { revenue: '#ABCDEF' }, dark: {} } })
    expect(response.status).toBe(200)
    const stored = { version: 1, palette: 'custom', base: 'daltonisme', custom: { light: { revenue: '#abcdef' }, dark: {} } }
    expect(db.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: MARIE.id },
      create: { userId: MARIE.id, appearance: stored },
      update: { appearance: stored },
    })
    expect(await response.json()).toMatchObject({ appearance: { palette: 'custom', base: 'daltonisme' }, isDefault: false })
    expect(enforceRateLimit).toHaveBeenCalledWith('account-appearance', MARIE.id)
  })

  it('cannot target another user: a userId in the body is refused', async () => {
    const response = await call(PUT, 'PUT', { palette: 'pastel', userId: 'u-other' })
    expect(response.status).toBe(400)
    expect(db.userPreference.upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['a non hex colour', { palette: 'custom', custom: { light: { revenue: 'red' } } }],
    ['an unknown preset', { palette: 'neon' }],
    ['an unknown series', { palette: 'custom', custom: { light: { profit: '#000000' } } }],
    ['no body', undefined],
  ])('answers 400 to %s without saving', async (_label, body) => {
    const response = await call(PUT, 'PUT', body)
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBeTruthy()
    expect(db.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('answers 413 to an oversized body', async () => {
    const response = await call(PUT, 'PUT', JSON.stringify({ palette: 'sobre', padding: 'x'.repeat(10_000) }))
    expect(response.status).toBe(413)
    expect(((await response.json()) as { error: string }).error).toBe('Requête trop volumineuse (maximum 4 Ko).')
    expect(db.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('refuses a cross-site request', async () => {
    const response = await call(PUT, 'PUT', { palette: 'pastel' }, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })
    expect(response.status).toBe(403)
    expect(db.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('answers 403 with the policy message when the instance refuses change-appearance', async () => {
    state.refused.add('change-appearance')
    const response = await call(PUT, 'PUT', { palette: 'pastel' })
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: string }).error).toBe('Refusé par la politique de cette instance.')
    expect(db.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('answers 429 past the rate limit', async () => {
    vi.mocked(enforceRateLimit).mockRejectedValueOnce(new RateLimitError('Trop de modifications.'))
    expect((await call(PUT, 'PUT', { palette: 'pastel' })).status).toBe(429)
    expect(db.userPreference.upsert).not.toHaveBeenCalled()
  })
})
