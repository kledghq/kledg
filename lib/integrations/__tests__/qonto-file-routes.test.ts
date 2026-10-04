/**
 * Qonto routes that read accounts and statements or send a receipt, with the
 * session, the company roles and Prisma mocked, and Qonto answered by a
 * stubbed fetch (no network):
 * - GET /api/qonto/accounts
 * - GET /api/qonto/statements/[id] and its PDF proxy
 * - POST /api/qonto/transactions/[id]/attachments/upload
 * Status codes, roles, input validation before any Qonto call, the stored
 * credentials of the company only, and no Qonto message or secret in any
 * response.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => {
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  return {
    user: { id: 'user-1', email: 'a@test.local', name: null, role: 'user' } as
      | null
      | { id: string; email: string; name: string | null; role: string | null },
    roles: ['companyAdmin'] as string[],
  }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/rbac/authorize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rbac/authorize')>()),
  getUserRolesForCompany: async () => state.roles,
}))
vi.mock('@/lib/companies/slug', () => ({ resolveCompanyRef: async (ref: string) => ref }))
vi.mock('@/lib/companies/archive-company.service', () => ({ assertCompanyWritable: async () => undefined }))
vi.mock('@/lib/banking/guard', () => ({ limitBankCalls: vi.fn(async () => {}), guardBankConnect: vi.fn(async () => {}) }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
// File downloads go through the public-address fetch (node:https); here they
// reach the stubbed global fetch. The address guard is tested in lib/__tests__/security/ssrf.test.ts.
vi.mock('@/lib/integrations/public-https-fetch', () => ({
  publicFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { limitBankCalls } from '@/lib/banking/guard'
import { QONTO_NOT_CONNECTED_MESSAGE } from '@/lib/integrations/providers/qonto/get-credentials'
import { FILE_UNAVAILABLE_MESSAGE } from '@/lib/integrations/providers/qonto/files'
import { GET as accountsRoute } from '@/app/api/qonto/accounts/route'
import { GET as statementRoute } from '@/app/api/qonto/statements/[id]/route'
import { GET as statementProxyRoute } from '@/app/api/qonto/statements/[id]/proxy/route'
import { POST as uploadRoute } from '@/app/api/qonto/transactions/[id]/attachments/upload/route'

const db = asPrismaMock(prisma)

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

const COMPANY = 'company-1'
const STATEMENT_ID = '7c1f0a52-2b3d-4c5e-8f60-71a2b3c4d5e6'
const TX_UUID = '0b7f1d64-5a8c-4b6e-9a51-3f1c2d3e4f50'
/** What Qonto writes in an error body: logged, never shown. */
const QONTO_DETAIL = 'Invalid API key for organization acme-sas-4242'
const SECRET = 'qonto-secret-key-0123'
const QONTO_REFUSED_HINT =
  "Qonto refuse l'accès : vérifiez l'identifiant et la clé secrète de l'API, puis mettez-les à jour depuis la page Banque."

async function call(handler: Handler, request: NextRequest, params: Record<string, string> = {}) {
  const response = await handler(request, { params: Promise.resolve(params) })
  const text = await response.text()
  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
  return { status: response.status, text, json: isJson ? (JSON.parse(text) as Record<string, unknown>) : null, headers: response.headers }
}

const get = (path: string) => new NextRequest(`http://localhost${path}`)

/** Qonto API stub: answers by path suffix; every call is recorded with its init. */
const qontoCalls: Array<{ url: URL; init?: RequestInit }> = []
function stubQonto(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      qontoCalls.push({ url, init })
      const match = Object.entries(routes).find(([path]) => url.pathname.endsWith(path))
      return match ? match[1]() : new Response('{}', { status: 500 })
    }),
  )
}
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const refused = (status = 401) => () => new Response(JSON.stringify({ errors: [{ detail: QONTO_DETAIL }] }), { status })

function storedCredentials() {
  db.bankConnection.findUnique.mockResolvedValue(null)
  db.integration.findFirst.mockResolvedValue({ credentials: { login: 'acme', secretKey: SECRET }, credentialsEncrypted: false })
}

const statement = (file: Partial<{ file_url: string; file_name: string; file_content_type: string }> = {}) => ({
  statement: {
    id: STATEMENT_ID,
    bank_account_id: 'acc-1',
    period: '08-2026',
    file: { file_name: 'releve-aout.pdf', file_content_type: 'application/pdf', file_size: '1024', file_url: 'https://files.qonto.com/s/aout.pdf', ...file },
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'user-1', email: 'a@test.local', name: null, role: 'user' }
  state.roles = ['companyAdmin']
  qontoCalls.length = 0
  storedCredentials()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/qonto/accounts', () => {
  const path = `/api/qonto/accounts?companyId=${COMPANY}`

  it('returns the bank accounts of the organization to a viewer, with the stored API key', async () => {
    state.roles = ['viewer']
    stubQonto({
      '/organization': ok({ organization: { bank_accounts: [{ id: 'acc-1', slug: 'main', iban: 'FR7616958000016543210987654', balance: 1520.5, currency: 'EUR' }] } }),
    })
    const response = await call(accountsRoute, get(path))
    expect(response.status).toBe(200)
    expect(response.json).toEqual({
      accounts: [{ id: 'acc-1', slug: 'main', iban: 'FR7616958000016543210987654', balance: 1520.5, currency: 'EUR' }],
    })
    expect(limitBankCalls).toHaveBeenCalledWith(COMPANY)
    expect(new Headers(qontoCalls[0].init?.headers).get('authorization')).toBe(`acme:${SECRET}`)
    expect(db.integration.findFirst.mock.calls[0][0]?.where).toEqual({ companyId: COMPANY, provider: 'QONTO', status: 'active', type: 'BANKING' })
  })

  it('answers 404 to a non-member and 401 to an anonymous user, without calling Qonto', async () => {
    stubQonto({})
    state.roles = []
    expect((await call(accountsRoute, get(path))).status).toBe(404)
    state.user = null
    expect((await call(accountsRoute, get(path))).status).toBe(401)
    expect(qontoCalls).toEqual([])
  })

  it('answers 404 in French when Qonto is not connected', async () => {
    stubQonto({})
    db.integration.findFirst.mockResolvedValue(null)
    const response = await call(accountsRoute, get(path))
    expect(response.status).toBe(404)
    expect(response.json).toEqual({ error: QONTO_NOT_CONNECTED_MESSAGE })
    expect(qontoCalls).toEqual([])
  })

  it('maps a Qonto refusal to the French advice, never Qonto\'s message or the key', async () => {
    stubQonto({ '/organization': refused(401) })
    const response = await call(accountsRoute, get(path))
    expect(response.status).toBe(502)
    expect(response.json).toEqual({ error: QONTO_REFUSED_HINT })
    expect(response.text).not.toContain(QONTO_DETAIL)
    expect(response.text).not.toContain(SECRET)
  })
})

describe('GET /api/qonto/statements/[id]', () => {
  const path = (id: string) => `/api/qonto/statements/${id}?companyId=${COMPANY}`

  it('returns the statement read from Qonto with the company credentials', async () => {
    state.roles = ['viewer']
    stubQonto({ [`/statements/${STATEMENT_ID}`]: ok(statement()) })
    const response = await call(statementRoute, get(path(STATEMENT_ID)), { id: STATEMENT_ID })
    expect(response.status).toBe(200)
    expect(response.json).toEqual(statement())
    expect(qontoCalls.map((c) => c.url.pathname)).toEqual([`/v2/statements/${STATEMENT_ID}`])
  })

  it('refuses an id that could change the Qonto path, before calling Qonto', async () => {
    stubQonto({})
    for (const id of ['..%2Forganization', 'a/b', 'x?y=1', 'a'.repeat(101)]) {
      const response = await call(statementRoute, get(path('x')), { id })
      expect(response.status, id).toBe(400)
      expect(response.json).toEqual({ error: 'Identifiant de relevé invalide.' })
    }
    expect(qontoCalls).toEqual([])
  })

  it('answers 404 to a member of another company', async () => {
    stubQonto({})
    state.roles = []
    expect((await call(statementRoute, get(path(STATEMENT_ID)), { id: STATEMENT_ID })).status).toBe(404)
    expect(qontoCalls).toEqual([])
  })

  it('maps a statement Qonto does not know to its French 502 message', async () => {
    stubQonto({ [`/statements/${STATEMENT_ID}`]: refused(404) })
    const response = await call(statementRoute, get(path(STATEMENT_ID)), { id: STATEMENT_ID })
    expect(response.status).toBe(502)
    expect(response.json).toEqual({ error: "Qonto ne trouve pas l'élément demandé : actualisez la page puis réessayez." })
  })
})

describe('GET /api/qonto/statements/[id]/proxy', () => {
  const path = `/api/qonto/statements/${STATEMENT_ID}/proxy?companyId=${COMPANY}`

  it('serves the PDF from the URL of the Qonto response, inline and not cached', async () => {
    stubQonto({ [`/statements/${STATEMENT_ID}`]: ok(statement()), '/s/aout.pdf': () => new Response('%PDF-1.7 releve', { status: 200 }) })
    const response = await call(statementProxyRoute, get(path), { id: STATEMENT_ID })
    expect(response.status).toBe(200)
    expect(response.text).toBe('%PDF-1.7 releve')
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain('inline')
    expect(response.headers.get('content-disposition')).toContain('releve-aout.pdf')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(qontoCalls.map((c) => c.url.toString())).toEqual([
      `https://thirdparty.qonto.com/v2/statements/${STATEMENT_ID}`,
      'https://files.qonto.com/s/aout.pdf',
    ])
  })

  it('names the file after the statement when Qonto gives no name or type', async () => {
    stubQonto({
      [`/statements/${STATEMENT_ID}`]: ok(statement({ file_name: '', file_content_type: '' })),
      '/s/aout.pdf': () => new Response('%PDF', { status: 200 }),
    })
    const response = await call(statementProxyRoute, get(path), { id: STATEMENT_ID })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain(`releve-${STATEMENT_ID}.pdf`)
  })

  it('answers 404 when the statement has no file', async () => {
    stubQonto({ [`/statements/${STATEMENT_ID}`]: ok(statement({ file_url: '' })) })
    const response = await call(statementProxyRoute, get(path), { id: STATEMENT_ID })
    expect(response.status).toBe(404)
    expect(response.json).toEqual({ error: 'Relevé non trouvé ou fichier non disponible' })
    expect(qontoCalls).toHaveLength(1)
  })

  it('never fetches a file URL outside the Qonto hosts', async () => {
    stubQonto({ [`/statements/${STATEMENT_ID}`]: ok(statement({ file_url: 'http://169.254.169.254/latest/meta-data' })) })
    const response = await call(statementProxyRoute, get(path), { id: STATEMENT_ID })
    expect(response.status).toBe(404)
    expect(response.json).toEqual({ error: FILE_UNAVAILABLE_MESSAGE })
    expect(qontoCalls.map((c) => c.url.hostname)).toEqual(['thirdparty.qonto.com'])
  })

  it('refuses an invalid id and a non-member before calling Qonto', async () => {
    stubQonto({})
    expect((await call(statementProxyRoute, get(path), { id: '../organization' })).status).toBe(400)
    state.roles = []
    expect((await call(statementProxyRoute, get(path), { id: STATEMENT_ID })).status).toBe(404)
    expect(qontoCalls).toEqual([])
  })
})

describe('POST /api/qonto/transactions/[id]/attachments/upload', () => {
  function upload(file: File | string | null, companyId = COMPANY) {
    const form = new FormData()
    form.append('companyId', companyId)
    if (file !== null) form.append('file', file)
    return new NextRequest(`http://localhost/api/qonto/transactions/${TX_UUID}/attachments/upload`, { method: 'POST', body: form })
  }
  const pdf = () => new File(['%PDF-1.7 facture'], 'facture.pdf', { type: 'application/pdf' })

  it('sends the file to the Qonto transaction with an idempotency key', async () => {
    state.roles = ['accountant']
    stubQonto({ [`/transactions/${TX_UUID}/attachments`]: () => new Response(null, { status: 200 }) })
    const response = await call(uploadRoute, upload(pdf()), { id: TX_UUID })
    expect(response.status).toBe(200)
    expect(response.json).toEqual({ success: true, message: 'Attachment uploadé avec succès' })

    expect(qontoCalls).toHaveLength(1)
    const [{ url, init }] = qontoCalls
    expect(url.pathname).toBe(`/v2/transactions/${TX_UUID}/attachments`)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`acme:${SECRET}`)
    expect(headers.get('x-qonto-idempotency-key')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    // multipart: fetch sets the content type with the boundary
    expect(headers.get('content-type')).toBeNull()
    const sent = (init?.body as FormData).get('file') as File
    expect(sent.name).toBe('facture.pdf')
    expect(await sent.text()).toBe('%PDF-1.7 facture')
  })

  it('refuses a viewer (403) and a non-member (404) without calling Qonto', async () => {
    stubQonto({})
    state.roles = ['viewer']
    expect((await call(uploadRoute, upload(pdf()), { id: TX_UUID })).status).toBe(403)
    state.roles = []
    expect((await call(uploadRoute, upload(pdf()), { id: TX_UUID })).status).toBe(404)
    expect(qontoCalls).toEqual([])
  })

  it('validates the transaction id, the file and its type in French before calling Qonto', async () => {
    stubQonto({})
    const cases: Array<[NextRequest, string, string]> = [
      [upload(pdf()), 'tx-123', 'Identifiant de transaction invalide.'],
      [upload(null), TX_UUID, 'Joignez un fichier (JPEG, PNG ou PDF).'],
      [upload('pas un fichier'), TX_UUID, 'Joignez un fichier (JPEG, PNG ou PDF).'],
      [
        upload(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })),
        TX_UUID,
        'Type de fichier non autorisé. Seuls JPEG, PNG et PDF sont acceptés.',
      ],
    ]
    for (const [request, id, message] of cases) {
      const response = await call(uploadRoute, request, { id })
      expect(response.status, message).toBe(400)
      expect(response.json).toEqual({ error: message })
    }
    expect(qontoCalls).toEqual([])
  })

  it('answers 400 when the form names no company', async () => {
    stubQonto({})
    const form = new FormData()
    form.append('file', pdf())
    const request = new NextRequest(`http://localhost/api/qonto/transactions/${TX_UUID}/attachments/upload`, { method: 'POST', body: form })
    const response = await call(uploadRoute, request, { id: TX_UUID })
    expect(response.status).toBe(400)
    expect(response.json).toEqual({ error: 'companyId est requis' })
  })

  it('reports a Qonto rate limit in French as a 429', async () => {
    stubQonto({ [`/transactions/${TX_UUID}/attachments`]: refused(429) })
    const response = await call(uploadRoute, upload(pdf()), { id: TX_UUID })
    expect(response.status).toBe(429)
    expect(response.json).toEqual({ error: 'Qonto limite le nombre de requêtes : réessayez dans quelques minutes.' })
    expect(response.text).not.toContain(QONTO_DETAIL)
  })
})
