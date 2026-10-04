/**
 * Every route that connects a bank or tests credentials against it goes
 * through guardBankConnect (lib/banking/guard.ts): the instance policy
 * ("connect-bank"), same origin only, and the bank API rate limit. The real
 * guard runs here; the session, Prisma, the policy and the providers are
 * mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64)
  return { refused: new Set<string>(), limited: [] as string[] }
})

vi.mock('@/lib/companies/archive-company.service', () => ({ assertCompanyWritable: async () => undefined }))
vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-1', email: 'admin@test.local', name: null, role: null })),
}))
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/rbac/authorize', async () => ({
  ...(await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')),
  getUserRolesForCompany: vi.fn(async () => ['companyAdmin']),
  isGlobalAdmin: vi.fn(() => false),
}))
vi.mock('@/lib/companies/slug', () => ({ resolveCompanyRef: vi.fn(async (ref: string) => ref) }))
// The real policy (every hook and constant of the extension point), with the two refusals replaced.
vi.mock('@/lib/instance/policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instance/policy')>()),
  isActionAllowed: async (action: string) => !state.refused.has(action),
  actionRefusalMessage: () => 'Refusé par la politique de cette instance.',
}))
vi.mock('@/lib/rate-limit', async () => ({
  ...(await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit')),
  enforceRateLimit: vi.fn(async (name: string) => {
    state.limited.push(name)
  }),
}))
vi.mock('@/lib/integrations/providers/qonto/manage-qonto-connection.service', async () => ({
  ...(await vi.importActual<typeof import('@/lib/integrations/providers/qonto/manage-qonto-connection.service')>(
    '@/lib/integrations/providers/qonto/manage-qonto-connection.service',
  )),
  connectQonto: vi.fn(async () => ({ connected: true })),
  verifyQontoCredentials: vi.fn(async () => ({ valid: true })),
}))
vi.mock('@/lib/integrations/create-integration.service', async () => ({
  ...(await vi.importActual<typeof import('@/lib/integrations/create-integration.service')>('@/lib/integrations/create-integration.service')),
  createIntegration: vi.fn(async () => ({ id: 'int-1' })),
}))
vi.mock('@/lib/integrations/verify-bank-credentials.service', async () => ({
  ...(await vi.importActual<typeof import('@/lib/integrations/verify-bank-credentials.service')>('@/lib/integrations/verify-bank-credentials.service')),
  verifyBankCredentials: vi.fn(async () => ({ valid: true })),
}))

import { connectQonto, verifyQontoCredentials } from '@/lib/integrations/providers/qonto/manage-qonto-connection.service'
import { createIntegration } from '@/lib/integrations/create-integration.service'
import { verifyBankCredentials } from '@/lib/integrations/verify-bank-credentials.service'
import * as qontoConnect from '../qonto/connect/route'
import * as qontoVerify from '../qonto/verify/route'
import * as integrations from '../integrations/route'
import * as integrationsVerify from '../integrations/verify/route'

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

const ROUTES: Array<{ label: string; handler: Handler; url: string; body: unknown; service: () => unknown }> = [
  {
    label: 'POST /api/qonto/connect',
    handler: qontoConnect.POST,
    url: '/api/qonto/connect',
    body: { companyId: 'company-1', login: 'acme-1234', secretKey: 'secret-key-0001' },
    service: () => vi.mocked(connectQonto).mock.calls.length,
  },
  {
    label: 'POST /api/integrations',
    handler: integrations.POST,
    url: '/api/integrations',
    body: { companyId: 'company-1', provider: 'QONTO', type: 'BANKING', credentials: { login: 'acme-1234', secretKey: 'secret-key-0001' } },
    service: () => vi.mocked(createIntegration).mock.calls.length,
  },
  {
    label: 'POST /api/qonto/verify',
    handler: qontoVerify.POST,
    url: '/api/qonto/verify',
    body: { companyId: 'company-1', login: 'acme-1234', secretKey: 'secret-key-0001' },
    service: () => vi.mocked(verifyQontoCredentials).mock.calls.length,
  },
  {
    label: 'POST /api/integrations/verify',
    handler: integrationsVerify.POST,
    url: '/api/integrations/verify',
    body: { companyId: 'company-1', provider: 'QONTO', credentials: { login: 'acme-1234', secretKey: 'secret-key-0001' } },
    service: () => vi.mocked(verifyBankCredentials).mock.calls.length,
  },
]

function call(handler: Handler, url: string, body: unknown, headers: Record<string, string> = {}) {
  return handler(
    new NextRequest(`http://localhost${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  )
}

describe('bank connection guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.refused = new Set()
    state.limited = []
  })

  it.each(ROUTES.map((r) => [r.label, r] as const))('%s refuses a cross-site request', async (_label, r) => {
    const response = await call(r.handler, r.url, r.body, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })
    expect(response.status).toBe(403)
    expect(r.service()).toBe(0)
  })

  it.each(ROUTES.map((r) => [r.label, r] as const))('%s obeys the instance policy', async (_label, r) => {
    state.refused.add('connect-bank')
    const response = await call(r.handler, r.url, r.body)
    expect(response.status).toBe(403)
    expect(r.service()).toBe(0)
  })

  it.each(ROUTES.map((r) => [r.label, r] as const))('%s counts the bank API rate limit', async (_label, r) => {
    const response = await call(r.handler, r.url, r.body, { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' })
    expect(response.status).toBeLessThan(300)
    expect(state.limited).toContain('bank-api')
    expect(r.service()).toBe(1)
  })
})
