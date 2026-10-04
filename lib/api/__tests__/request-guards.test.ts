/**
 * Request guards of the route wrappers (lib/api/route.ts), on real route
 * handlers with the session and Prisma mocked:
 *
 * CSRF: a state-changing request that carries the session cookie must come
 * from this instance (Sec-Fetch-Site, Origin) and send JSON (or multipart on
 * file routes). A text/plain or form-encoded body is what a cross-site HTML
 * form can send without a CORS preflight; SameSite=Lax alone leaves sibling
 * subdomains and old browsers. Requests without a cookie carry no ambient
 * credential (MCP bearer tokens and cron secrets use their own routes).
 *
 * Body size: the body is read as a stream and counted, never trusted from
 * Content-Length: 1 MB by default for JSON, the upload limit for file
 * routes, 413 beyond. A chunked body without Content-Length is counted too.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/companies/archive-company.service', () => ({ assertCompanyWritable: async () => undefined }))
vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-1', email: 'u@test.local', name: null, role: null })),
}))
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/rbac/authorize', async () => ({
  ...(await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')),
  getUserRolesForCompany: vi.fn(async () => ['companyAdmin']),
  isGlobalAdmin: vi.fn(() => false),
}))
vi.mock('@/lib/companies/slug', () => ({ resolveCompanyRef: vi.fn(async (ref: string) => ref) }))

import { z } from 'zod'
import { companyRoute, fromBody, fromForm, DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/route'
import { MAX_UPLOAD_BYTES } from '@/lib/api/files'

const handled = vi.fn()

const jsonRoute = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: z.object({ companyId: z.string(), note: z.string().optional() }) },
  async ({ body }) => {
    handled(body)
    return Response.json({ ok: true })
  },
)

const fileRoute = companyRoute({ company: fromForm(), permission: { entries: ['create'] }, multipart: true }, async ({ request }) => {
  const form = await request.formData()
  handled((form.get('file') as File | null)?.size ?? null)
  return Response.json({ ok: true })
})

const ORIGIN = 'http://localhost'
const COOKIE = 'better-auth.session_token=abc.def'

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1]

function post(body: BodyInit | null, headers: Record<string, string>, init: { duplex?: 'half' } = {}) {
  return new NextRequest(`${ORIGIN}/api/test`, { method: 'POST', headers, body, ...init } as NextRequestInit)
}

function stream(size: number, chunk = 64 * 1024): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent >= size) return controller.close()
      const n = Math.min(chunk, size - sent)
      sent += n
      controller.enqueue(new Uint8Array(n).fill(0x20))
    },
  })
}

const json = (value: unknown) => JSON.stringify(value)

describe('CSRF guard of state-changing routes', () => {
  beforeEach(() => handled.mockReset())

  it('refuses a cross-site request carrying the session cookie', async () => {
    const variants: Array<Record<string, string>> = [
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      { origin: 'https://evil.example' },
    ]
    for (const headers of variants) {
      const response = await jsonRoute(post(json({ companyId: 'c1' }), { cookie: COOKIE, 'content-type': 'application/json', ...headers }))
      expect(response.status, JSON.stringify(headers)).toBe(403)
    }
    expect(handled).not.toHaveBeenCalled()
  })

  it('refuses a body that a cross-site form can send without preflight (text/plain, urlencoded)', async () => {
    for (const type of ['text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const response = await jsonRoute(post(json({ companyId: 'c1' }), { cookie: COOKIE, 'content-type': type }))
      expect(response.status, type).toBe(415)
    }
    expect(handled).not.toHaveBeenCalled()
  })

  it('accepts a same-origin JSON request', async () => {
    const response = await jsonRoute(
      post(json({ companyId: 'c1' }), { cookie: COOKIE, 'content-type': 'application/json', origin: ORIGIN, 'sec-fetch-site': 'same-origin' }),
    )
    expect(response.status).toBe(200)
    expect(handled).toHaveBeenCalledWith({ companyId: 'c1' })
  })

  it('requires multipart on file routes', async () => {
    const response = await fileRoute(post(json({ companyId: 'c1' }), { cookie: COOKIE, 'content-type': 'application/json' }))
    expect(response.status).toBe(415)
    const form = new FormData()
    form.set('companyId', 'c1')
    form.set('file', new File(['Date;Montant\n'], 'releve.csv'))
    const ok = await fileRoute(new NextRequest(`${ORIGIN}/api/test`, { method: 'POST', headers: { cookie: COOKIE, origin: ORIGIN }, body: form }))
    expect(ok.status).toBe(200)
    expect(handled).toHaveBeenCalledWith(13)
  })
})

describe('body size limits', () => {
  beforeEach(() => handled.mockReset())

  it('refuses a JSON body over the default limit, whatever Content-Length says', async () => {
    const big = json({ companyId: 'c1', note: 'x'.repeat(DEFAULT_MAX_JSON_BODY_BYTES) })
    expect((await jsonRoute(post(big, { 'content-type': 'application/json' }))).status).toBe(413)
    // Chunked: no Content-Length at all.
    const chunked = post(stream(DEFAULT_MAX_JSON_BODY_BYTES + 10), { 'content-type': 'application/json' }, { duplex: 'half' })
    expect(chunked.headers.get('content-length')).toBeNull()
    expect((await jsonRoute(chunked)).status).toBe(413)
    expect(handled).not.toHaveBeenCalled()
  })

  it('refuses an upload over the file limit even without Content-Length', async () => {
    const chunked = post(stream(MAX_UPLOAD_BYTES + 128 * 1024), { 'content-type': 'multipart/form-data; boundary=x' }, { duplex: 'half' })
    expect((await fileRoute(chunked)).status).toBe(413)
    expect(handled).not.toHaveBeenCalled()
  })

  it('reads the body once: the handler still gets it', async () => {
    const response = await jsonRoute(post(json({ companyId: 'c1', note: 'bonjour' }), { 'content-type': 'application/json' }))
    expect(response.status).toBe(200)
    expect(handled).toHaveBeenCalledWith({ companyId: 'c1', note: 'bonjour' })
  })
})
