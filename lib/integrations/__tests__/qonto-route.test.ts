/**
 * Qonto routes (app/api/qonto/** and the receipt proxy) with the session,
 * the company roles and Prisma mocked, and Qonto answered by a stubbed fetch:
 * status codes, authorization, input validation, company scoping of every
 * lookup, and no Qonto message or secret in any response.
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
vi.mock('@/lib/companies/archive-company.service', () => ({ assertCompanyWritable: async () => undefined }))
vi.mock('@/lib/rbac/authorize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rbac/authorize')>()),
  getUserRolesForCompany: async () => state.roles,
}))
vi.mock('@/lib/companies/slug', () => ({ resolveCompanyRef: async (ref: string) => ref }))
vi.mock('@/lib/banking/guard', () => ({ limitBankCalls: vi.fn(async () => {}), guardBankConnect: vi.fn(async () => {}) }))
// File downloads go through the public-address fetch (node:https); here they
// reach the stubbed global fetch. The address guard itself is tested in
// lib/__tests__/security/ssrf.test.ts.
vi.mock('@/lib/integrations/public-https-fetch', () => ({
  publicFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { bankConnectionContext, decrypt } from '@/lib/integrations/encryption'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { guardBankConnect, limitBankCalls } from '@/lib/banking/guard'
import { QONTO_CREDENTIALS_REFUSED } from '@/lib/banking/errors'
import * as statusRoute from '@/app/api/qonto/status/route'
import * as connectRoute from '@/app/api/qonto/connect/route'
import * as testConnectionRoute from '@/app/api/qonto/test-connection/route'
import * as verifyRoute from '@/app/api/qonto/verify/route'
import * as statementsRoute from '@/app/api/qonto/statements/route'
import * as attachmentsRoute from '@/app/api/qonto/transactions/[id]/attachments/route'
import * as proxyRoute from '@/app/api/banking/attachments/[attachmentId]/proxy/route'

const db = asPrismaMock(prisma)

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

const COMPANY = 'company-1'
const QONTO_UUID = '0b7f1d64-5a8c-4b6e-9a51-3f1c2d3e4f50'
/** What Qonto writes in an error body: logged, never shown. */
const QONTO_DETAIL = 'Invalid API key for organization acme-sas-4242'
const SECRET = 'qonto-secret-key-0123'

function request(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

async function call(handler: Handler, method: string, path: string, options: { body?: unknown; params?: Record<string, string> } = {}) {
  const response = await handler(request(method, path, options.body), { params: Promise.resolve(options.params ?? {}) })
  const text = await response.text()
  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
  return { status: response.status, text, json: isJson ? (JSON.parse(text) as Record<string, unknown>) : null, headers: response.headers }
}

/** Qonto API stub: answers by path; every call is recorded. */
const qontoCalls: URL[] = []
function stubQonto(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      qontoCalls.push(url)
      const match = Object.entries(routes).find(([path]) => url.pathname.endsWith(path))
      return match ? match[1]() : new Response('{}', { status: 500 })
    }),
  )
}
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const refused = () => () => new Response(JSON.stringify({ errors: [{ detail: QONTO_DETAIL }] }), { status: 401 })

/** Stored Qonto credentials of the company (integration, not encrypted). */
function storedCredentials() {
  db.bankConnection.findUnique.mockResolvedValue(null)
  db.integration.findFirst.mockResolvedValue({ credentials: { login: 'acme', secretKey: SECRET }, credentialsEncrypted: false })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'user-1', email: 'a@test.local', name: null, role: 'user' }
  state.roles = ['companyAdmin']
  qontoCalls.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('access to the Qonto routes', () => {
  const cases: Array<[string, Handler, string, string, unknown?]> = [
    ['connect', connectRoute.POST, 'POST', '/api/qonto/connect', { companyId: COMPANY, login: 'acme', secretKey: SECRET }],
    ['test connection', testConnectionRoute.POST, 'POST', '/api/qonto/test-connection', { companyId: COMPANY }],
    ['verify', verifyRoute.POST, 'POST', '/api/qonto/verify', { companyId: COMPANY, login: 'acme', secretKey: SECRET }],
  ]

  it.each(cases)('%s: 401 anonymous, 404 non-member, 403 accountant and viewer, no Qonto call', async (_label, handler, method, path, body) => {
    stubQonto({})
    state.user = null
    expect((await call(handler, method, path, { body })).status).toBe(401)
    state.user = { id: 'user-2', email: 'b@test.local', name: null, role: 'user' }
    state.roles = []
    expect((await call(handler, method, path, { body })).status).toBe(404)
    for (const role of ['accountant', 'viewer']) {
      state.roles = [role]
      expect((await call(handler, method, path, { body })).status, role).toBe(403)
    }
    expect(qontoCalls).toEqual([])
    expect(limitBankCalls).not.toHaveBeenCalled()
    expect(guardBankConnect).not.toHaveBeenCalled()
  })

  it('lets a viewer read the status, without credentials', async () => {
    state.roles = ['viewer']
    db.bankConnection.findUnique.mockResolvedValue({
      provider: 'QONTO',
      status: 'active',
      lastSyncAt: null,
      selectedAccountId: null,
      _count: { bankAccounts: 2 },
      selectedAccount: null,
    })
    const response = await call(statusRoute.GET, 'GET', `/api/qonto/status?companyId=${COMPANY}`)
    expect(response.status).toBe(200)
    expect(response.json).toMatchObject({ connected: true, provider: 'QONTO', accountsCount: 2, selectedAccount: null })
    const args = db.bankConnection.findUnique.mock.calls[0][0]
    expect(args.where).toEqual({ companyId_provider: { companyId: COMPANY, provider: 'QONTO' } })
    expect(Object.keys(args.select ?? {})).not.toContain('secretKeyEncrypted')
    expect(Object.keys(args.select ?? {})).not.toContain('login')
  })
})

describe('POST /api/qonto/connect', () => {
  it('validates the body before calling Qonto', async () => {
    stubQonto({})
    const response = await call(connectRoute.POST, 'POST', '/api/qonto/connect', { body: { companyId: COMPANY, login: 'acme' } })
    expect(response.status).toBe(400)
    expect(response.json?.error).toMatch(/Saisissez l'identifiant et la clé secrète/)
    expect(qontoCalls).toEqual([])
  })

  it('answers a French message when Qonto refuses the credentials, never Qonto\'s', async () => {
    stubQonto({ '/organization': refused() })
    const response = await call(connectRoute.POST, 'POST', '/api/qonto/connect', { body: { companyId: COMPANY, login: 'acme', secretKey: SECRET } })
    expect(response.status).toBe(400)
    expect(response.json).toEqual({ error: QONTO_CREDENTIALS_REFUSED })
    expect(response.text).not.toContain(QONTO_DETAIL)
    expect(db.bankConnection.upsert).not.toHaveBeenCalled()
  })

  it('refuses an account that is not in the organization', async () => {
    stubQonto({ '/organization': ok({ organization: { bank_accounts: [{ iban: 'FR76AAA', slug: 'acme-1' }] } }) })
    const response = await call(connectRoute.POST, 'POST', '/api/qonto/connect', {
      body: { companyId: COMPANY, login: 'acme', secretKey: SECRET, selectedAccountId: 'FR76BBB' },
    })
    expect(response.status).toBe(400)
    expect(db.bankConnection.upsert).not.toHaveBeenCalled()
  })

  it('stores the secret encrypted on the company connection and never returns it', async () => {
    stubQonto({ '/organization': ok({ organization: { bank_accounts: [{ iban: 'FR76AAA', slug: 'acme-1' }] } }) })
    db.bankConnection.upsert.mockResolvedValue({ id: 'conn-1', companyId: COMPANY, provider: 'QONTO', status: 'active', selectedAccountId: 'FR76AAA' })
    const response = await call(connectRoute.POST, 'POST', '/api/qonto/connect', {
      body: { companyId: COMPANY, login: ' acme ', secretKey: SECRET, selectedAccountId: 'FR76AAA' },
    })
    expect(response.status).toBe(200)
    expect(response.text).not.toContain(SECRET)
    expect(guardBankConnect).toHaveBeenCalledWith(expect.anything(), COMPANY, expect.anything())
    const args = db.bankConnection.upsert.mock.calls[0][0]
    expect(args.where).toEqual({ companyId_provider: { companyId: COMPANY, provider: 'QONTO' } })
    expect(args.create).toMatchObject({ companyId: COMPANY, login: 'acme', selectedAccountId: 'FR76AAA', status: 'active' })
    expect(args.create.secretKeyEncrypted).not.toBe(SECRET)
    expect(decrypt(args.create.secretKeyEncrypted as string, getEncryptionKey()!, bankConnectionContext(COMPANY, 'QONTO'))).toBe(SECRET)
    expect(Object.keys(args.select ?? {})).not.toContain('secretKeyEncrypted')
    expect(Object.keys(args.select ?? {})).not.toContain('login')
  })
})

describe('Qonto credential checks', () => {
  it('test-connection: valid with the stored credentials', async () => {
    storedCredentials()
    stubQonto({ '/organization': ok({ organization: { bank_accounts: [{ iban: 'FR76AAA' }, { iban: 'FR76BBB' }] } }) })
    const response = await call(testConnectionRoute.POST, 'POST', '/api/qonto/test-connection', { body: { companyId: COMPANY } })
    expect(response.status).toBe(200)
    expect(response.json).toEqual({ valid: true, organization: { bankAccountsCount: 2 } })
    expect(db.integration.findFirst.mock.calls[0][0]?.where).toMatchObject({ companyId: COMPANY, provider: 'QONTO' })
  })

  it('test-connection: { valid: false } with a French reason when Qonto refuses', async () => {
    storedCredentials()
    stubQonto({ '/organization': refused() })
    const response = await call(testConnectionRoute.POST, 'POST', '/api/qonto/test-connection', { body: { companyId: COMPANY } })
    expect(response.status).toBe(400)
    expect(response.json?.valid).toBe(false)
    expect(response.json?.error).toMatch(/^Qonto refuse l'accès/)
    expect(response.text).not.toContain(QONTO_DETAIL)
  })

  it('test-connection: 404 when Qonto is not connected', async () => {
    db.bankConnection.findUnique.mockResolvedValue(null)
    db.integration.findFirst.mockResolvedValue(null)
    stubQonto({})
    const response = await call(testConnectionRoute.POST, 'POST', '/api/qonto/test-connection', { body: { companyId: COMPANY } })
    expect(response.status).toBe(404)
    expect(qontoCalls).toEqual([])
  })

  it('verify: validates the body, then answers { valid: false } with a French reason', async () => {
    stubQonto({ '/organization': refused() })
    const missing = await call(verifyRoute.POST, 'POST', '/api/qonto/verify', { body: { companyId: COMPANY, login: 'acme' } })
    expect(missing.status).toBe(400)
    expect(qontoCalls).toEqual([])

    const response = await call(verifyRoute.POST, 'POST', '/api/qonto/verify', { body: { companyId: COMPANY, login: 'acme', secretKey: SECRET } })
    expect(response.status).toBe(400)
    expect(response.json?.valid).toBe(false)
    expect(response.text).not.toContain(QONTO_DETAIL)
    expect(response.text).not.toContain(SECRET)
  })

  it('verify: never answers an unexpected failure with its own message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND thirdparty.qonto.com')
      }),
    )
    const response = await call(verifyRoute.POST, 'POST', '/api/qonto/verify', { body: { companyId: COMPANY, login: 'acme', secretKey: SECRET } })
    expect(response.json?.valid).toBe(false)
    expect(response.text).not.toContain('ENOTFOUND')
  })
})

describe('/api/qonto/statements', () => {
  beforeEach(storedCredentials)

  it('reads the filters of the query string', async () => {
    stubQonto({ '/statements': ok({ statements: [], meta: { total_count: 0 } }) })
    const response = await call(
      statementsRoute.GET,
      'GET',
      `/api/qonto/statements?companyId=${COMPANY}&page=2&perPage=500&sortBy=period:desc&bank_account_ids[]=acme-1,acme-2&period_from=01-2026`,
    )
    expect(response.status).toBe(200)
    const url = qontoCalls[0]
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('per_page')).toBe('100')
    expect(url.searchParams.get('sort_by')).toBe('period:desc')
    expect(url.searchParams.getAll('bank_account_ids[]')).toEqual(['acme-1', 'acme-2'])
    expect(limitBankCalls).toHaveBeenCalledWith(COMPANY)
  })

  it('answers 400 to an invalid sort or page, without calling Qonto', async () => {
    stubQonto({})
    expect((await call(statementsRoute.GET, 'GET', `/api/qonto/statements?companyId=${COMPANY}&sortBy=amount`)).status).toBe(400)
    expect((await call(statementsRoute.GET, 'GET', `/api/qonto/statements?companyId=${COMPANY}&page=0`)).status).toBe(400)
    expect((await call(statementsRoute.POST, 'POST', '/api/qonto/statements', { body: { companyId: COMPANY, page: 'x' } })).status).toBe(400)
    expect(qontoCalls).toEqual([])
  })

  it('returns every statement with getAll, from the body too', async () => {
    stubQonto({ '/statements': ok({ statements: [{ id: 's1' }], meta: { total_count: 1, next_page: null } }) })
    const response = await call(statementsRoute.POST, 'POST', '/api/qonto/statements', { body: { companyId: COMPANY, getAll: true, ibans: ['FR76AAA'] } })
    expect(response.status).toBe(200)
    expect(response.json).toEqual({ statements: [{ id: 's1' }], meta: { total_count: 1 } })
  })
})

describe('GET /api/qonto/transactions/[id]/attachments', () => {
  beforeEach(storedCredentials)

  it('looks a non UUID reference up among the transactions of the company only', async () => {
    db.bankTransaction.findFirst.mockResolvedValue(null)
    stubQonto({})
    const response = await call(attachmentsRoute.GET, 'GET', `/api/qonto/transactions/tx-other/attachments?companyId=${COMPANY}`, {
      params: { id: 'tx-other' },
    })
    expect(response.status).toBe(404)
    expect(db.bankTransaction.findFirst.mock.calls[0][0]?.where).toMatchObject({
      externalTransactionId: 'tx-other',
      bankAccount: { bankConnection: { companyId: COMPANY } },
    })
    expect(qontoCalls).toEqual([])
  })

  it('lists the attachments of a Qonto transaction with a bounded page size', async () => {
    stubQonto({ '/attachments': ok({ attachments: [{ id: 'att-1' }], meta: {} }) })
    const path = `/api/qonto/transactions/${QONTO_UUID}/attachments?companyId=${COMPANY}&per_page=20`
    const response = await call(attachmentsRoute.GET, 'GET', path, { params: { id: QONTO_UUID } })
    expect(response.status).toBe(200)
    expect(response.json).toMatchObject({ attachments: [{ id: 'att-1' }] })
    expect(qontoCalls[0].searchParams.get('per_page')).toBe('20')

    const tooMany = await call(attachmentsRoute.GET, 'GET', `${path.replace('per_page=20', 'per_page=1000')}`, { params: { id: QONTO_UUID } })
    expect(tooMany.status).toBe(400)
  })
})

describe('GET /api/banking/attachments/[attachmentId]/proxy', () => {
  beforeEach(storedCredentials)

  const proxy = (query = '') =>
    call(proxyRoute.GET, 'GET', `/api/banking/attachments/att-1/proxy?companyId=${COMPANY}${query}`, { params: { attachmentId: 'att-1' } })

  it('serves a stored receipt of the company from a fresh Qonto URL', async () => {
    db.attachment.findFirst
      .mockResolvedValueOnce({ companyId: COMPANY }) // resolver
      .mockResolvedValueOnce({
        externalAttachmentId: 'qa-1',
        transactionUuid: QONTO_UUID,
        fileName: 'facture.pdf',
        fileContentType: 'application/pdf',
        fileUrl: null,
        bankTransaction: null,
      })
    stubQonto({
      '/attachments': ok({ attachments: [{ id: 'qa-1', url: 'https://files.qonto.com/qa-1.pdf', file_name: 'facture.pdf', file_content_type: 'application/pdf' }] }),
      '/qa-1.pdf': () => new Response('%PDF-1.7', { status: 200 }),
    })
    const response = await proxy()
    expect(response.status).toBe(200)
    expect(response.text).toBe('%PDF-1.7')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(db.attachment.findFirst.mock.calls[1][0]?.where).toMatchObject({ companyId: COMPANY })
  })

  it('requires a transaction of the company for a receipt not synced yet', async () => {
    db.attachment.findFirst.mockResolvedValue(null)
    stubQonto({})
    expect((await proxy()).status).toBe(404)

    db.bankTransaction.findFirst.mockResolvedValue(null)
    expect((await proxy(`&transactionUuid=${QONTO_UUID}`)).status).toBe(404)
    expect(db.bankTransaction.findFirst.mock.calls[0][0]?.where).toMatchObject({
      externalTransactionId: QONTO_UUID,
      bankAccount: { bankConnection: { companyId: COMPANY } },
    })
    expect(qontoCalls).toEqual([])
  })
})
