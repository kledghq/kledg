/**
 * Integration routes (app/api/integrations/**) with a mocked session and
 * Prisma: status codes, authorization, input validation and what the
 * services send to the database and back to the client.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64)
  return { user: { id: 'user-1', email: 'test@example.com', name: null, role: null } as null | Record<string, unknown> }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => state.user) }))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/companies/archive-company.service', () => ({ assertCompanyWritable: async () => undefined }))

vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return {
    ...actual,
    getUserRolesForCompany: vi.fn().mockResolvedValue(['companyAdmin']),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})

// Company references resolve to themselves (no slug lookup)
vi.mock('@/lib/companies/slug', () => ({ resolveCompanyRef: vi.fn(async (ref: string) => ref) }))

vi.mock('@/lib/banking/guard', () => ({
  guardBankConnect: vi.fn(async () => undefined),
  limitBankCalls: vi.fn(async () => undefined),
}))

vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/integrations/sync', () => ({ syncIntegration: vi.fn() }))

vi.mock('@/lib/banking/providers', () => ({ createBankProvider: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { getUserRolesForCompany } from '@/lib/rbac/authorize'
import { guardBankConnect, limitBankCalls } from '@/lib/banking/guard'
import { writeAuditLog } from '@/lib/audit'
import { syncIntegration } from '@/lib/integrations/sync'
import { createBankProvider, type BankProvider } from '@/lib/banking/providers'
import { BankAuthorizationError } from '@/lib/banking/errors'
import { decrypt, encrypt } from '@/lib/integrations/encryption'
import { RateLimitError } from '@/lib/accounting/errors'
import * as list from '../integrations/route'
import * as one from '../integrations/[id]/route'
import * as credentials from '../integrations/[id]/credentials/route'
import * as features from '../integrations/[id]/features/route'
import * as resources from '../integrations/[id]/resources/route'
import * as syncOne from '../integrations/[id]/sync/route'
import * as syncAll from '../integrations/sync/route'

const db = asPrismaMock(prisma)
const roles = vi.mocked(getUserRolesForCompany)
const sync = vi.mocked(syncIntegration)
const createProvider = vi.mocked(createBankProvider)
const KEY = 'a'.repeat(64)

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

function call(handler: Handler, url: string, init: { method?: string; body?: unknown; rawBody?: string; id?: string } = {}) {
  const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body))
  const request = new NextRequest(`http://localhost${url}`, { method: init.method ?? 'GET', body })
  const params: Record<string, string> = init.id ? { id: init.id } : {}
  return handler(request, { params: Promise.resolve(params) })
}

/** The integration of the by-id routes belongs to company-1. */
function integrationOfCompany1() {
  db.integration.findUnique.mockResolvedValue({ companyId: 'company-1' })
}

function providerListing(accounts: number | Error): BankProvider {
  const listAccounts = vi.fn(async () => {
    if (accounts instanceof Error) throw accounts
    return Array.from({ length: accounts }, (_, i) => ({ externalId: `acc-${i}`, name: 'Compte', currency: 'EUR', balance: 0 }))
  })
  return { listAccounts } as unknown as BankProvider
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'user-1', email: 'test@example.com', name: null, role: null }
  roles.mockResolvedValue(['companyAdmin'])
})

describe('GET /api/integrations', () => {
  it('answers 401 when signed out', async () => {
    state.user = null
    expect((await call(list.GET, '/api/integrations?companyId=company-1')).status).toBe(401)
  })

  it('answers 400 without a company', async () => {
    expect((await call(list.GET, '/api/integrations')).status).toBe(400)
  })

  it('lists the integrations of the company for a viewer, without credentials or metadata', async () => {
    roles.mockResolvedValue(['viewer'])
    db.integration.findMany.mockResolvedValue([{ id: 'int-1', provider: 'QONTO', featureConfigs: [], resources: [] }])
    const response = await call(list.GET, '/api/integrations?companyId=company-1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ integrations: [{ id: 'int-1', provider: 'QONTO', featureConfigs: [], resources: [] }] })

    const args = db.integration.findMany.mock.calls[0][0]
    expect(args?.where).toEqual({ companyId: 'company-1' })
    expect(args?.select).toMatchObject({ id: true, name: true, featureConfigs: expect.any(Object), resources: expect.any(Object) })
    expect(args?.select).not.toHaveProperty('credentials')
    expect(args?.select).not.toHaveProperty('metadata')
  })
})

describe('POST /api/integrations', () => {
  const valid = {
    companyId: 'company-1',
    provider: 'QONTO',
    type: 'BANKING',
    name: 'Qonto',
    credentials: { login: 'org-login', secretKey: 'super-secret-key' },
    features: ['BANKING_ACCOUNTS', 'BANKING_TRANSACTIONS'],
  }

  it('answers 403 to an accountant (no bank connection management)', async () => {
    roles.mockResolvedValue(['accountant'])
    const response = await call(list.POST, '/api/integrations', { method: 'POST', body: valid })
    expect(response.status).toBe(403)
    expect(db.integration.create).not.toHaveBeenCalled()
  })

  it.each([
    ['an unsupported provider', { provider: 'REVOLUT' }, 'provider: Fournisseur non pris en charge : choisissez Qonto ou Ponto.'],
    ['missing credentials', { credentials: undefined }, 'credentials: Saisissez les identifiants de la connexion.'],
    ['another type', { type: 'STORAGE' }, 'type: Seules les connexions bancaires (BANKING) sont prises en charge.'],
    ['an unknown feature', { features: ['INVOICES'] }, 'features.0: Fonctionnalité inconnue : choisissez BANKING_ACCOUNTS ou BANKING_TRANSACTIONS.'],
  ])('answers 400 for %s', async (_label, change, message) => {
    const response = await call(list.POST, '/api/integrations', { method: 'POST', body: { ...valid, ...change } })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe(message)
    expect(db.integration.create).not.toHaveBeenCalled()
  })

  it('answers 409 when the provider is already connected', async () => {
    db.integration.count.mockResolvedValue(1)
    const response = await call(list.POST, '/api/integrations', { method: 'POST', body: valid })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('Qonto est déjà connecté pour cette société : modifiez la connexion existante.')
    expect(db.integration.create).not.toHaveBeenCalled()
  })

  it('stores the secret encrypted, with its features, under a lock, and returns no credentials', async () => {
    db.integration.count.mockResolvedValue(0)
    db.integration.create.mockResolvedValue({ id: 'int-1', provider: 'QONTO', name: 'Qonto' })
    const response = await call(list.POST, '/api/integrations', { method: 'POST', body: valid })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ integration: { id: 'int-1', provider: 'QONTO', name: 'Qonto' } })

    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect(db.integration.count).toHaveBeenCalledWith({ where: { companyId: 'company-1', provider: 'QONTO', type: 'BANKING' } })
    const args = db.integration.create.mock.calls[0][0]
    const stored = args.data.credentials as Record<string, string>
    expect(stored.login).toBe('org-login')
    expect(stored.secretKey).not.toBe('super-secret-key')
    expect(decrypt(stored.secretKey, KEY)).toBe('super-secret-key')
    expect(args.data).toMatchObject({
      companyId: 'company-1',
      credentialsEncrypted: true,
      featureConfigs: { create: [{ feature: 'BANKING_ACCOUNTS', enabled: true }, { feature: 'BANKING_TRANSACTIONS', enabled: true }] },
    })
    expect(args.select).not.toHaveProperty('credentials')
  })
})

describe('PUT /api/integrations/[id]', () => {
  const url = '/api/integrations/int-1'

  beforeEach(() => {
    integrationOfCompany1()
    db.integration.findFirst.mockResolvedValue({
      id: 'int-1',
      provider: 'QONTO',
      credentials: { login: 'old-login', secretKey: 'old-secret' },
      credentialsEncrypted: false,
    })
    db.integration.findUniqueOrThrow.mockResolvedValue({ id: 'int-1', provider: 'QONTO', status: 'active' })
  })

  it('answers 403 to an accountant before calling the bank', async () => {
    roles.mockResolvedValue(['accountant'])
    const response = await call(one.PUT, url, { method: 'PUT', id: 'int-1', body: { credentials: { login: 'l', secretKey: 's' } } })
    expect(response.status).toBe(403)
    expect(createProvider).not.toHaveBeenCalled()
  })

  it('answers 400 without credentials', async () => {
    const response = await call(one.PUT, url, { method: 'PUT', id: 'int-1', body: { name: 'Qonto 2' } })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('credentials: Saisissez les identifiants de la connexion.')
  })

  it('answers 404 for an integration of another company', async () => {
    db.integration.findFirst.mockResolvedValue(null)
    const response = await call(one.PUT, url, { method: 'PUT', id: 'int-1', body: { credentials: { login: 'l', secretKey: 's' } } })
    expect(response.status).toBe(404)
    expect(db.integration.findFirst.mock.calls[0][0]?.where).toEqual({ id: 'int-1', companyId: 'company-1' })
  })

  it('answers 400 with a French reason when the bank refuses the new key', async () => {
    createProvider.mockReturnValue(providerListing(new BankAuthorizationError('refused')))
    const response = await call(one.PUT, url, { method: 'PUT', id: 'int-1', body: { credentials: { login: 'l', secretKey: 'wrong' } } })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/^Qonto refuse ces identifiants/)
    expect(db.integration.update).not.toHaveBeenCalled()
  })

  it('stores checked credentials, replaces the features and returns no credentials', async () => {
    createProvider.mockReturnValue(providerListing(1))
    const response = await call(one.PUT, url, {
      method: 'PUT',
      id: 'int-1',
      body: { credentials: { login: 'new-login', secretKey: 'new-secret' }, features: ['BANKING_ACCOUNTS'] },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ integration: { id: 'int-1', provider: 'QONTO', status: 'active' } })
    expect(vi.mocked(guardBankConnect)).toHaveBeenCalledTimes(1)
    expect(createProvider).toHaveBeenCalledWith('QONTO', { login: 'new-login', secretKey: 'new-secret' })
    expect(db.integrationFeatureConfig.deleteMany).toHaveBeenCalledWith({ where: { integrationId: 'int-1' } })
    expect(db.integrationFeatureConfig.createMany).toHaveBeenCalledWith({
      data: [{ integrationId: 'int-1', feature: 'BANKING_ACCOUNTS', enabled: true }],
    })
    expect(db.integration.findUniqueOrThrow.mock.calls[0][0]?.select).not.toHaveProperty('credentials')
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith('info', 'Bank credentials updated', expect.objectContaining({ action: 'BANK_CREDENTIALS_UPDATE' }))
  })
})

describe('GET /api/integrations/[id]/credentials', () => {
  const url = '/api/integrations/int-1/credentials'

  beforeEach(integrationOfCompany1)

  it('answers 403 to an accountant', async () => {
    roles.mockResolvedValue(['accountant'])
    expect((await call(credentials.GET, url, { id: 'int-1' })).status).toBe(403)
  })

  it('answers 404 when the integration is not in the company', async () => {
    db.integration.findFirst.mockResolvedValue(null)
    const response = await call(credentials.GET, url, { id: 'int-1' })
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('Connexion bancaire introuvable')
  })

  it('returns the login and a masked hint of an encrypted secret, never the secret', async () => {
    db.integration.findFirst.mockResolvedValue({
      provider: 'QONTO',
      type: 'BANKING',
      credentials: { login: 'org-login', secretKey: encrypt('my-long-secret-1234', KEY) },
      credentialsEncrypted: true,
    })
    const response = await call(credentials.GET, url, { id: 'int-1' })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('my-long-secret')
    expect(JSON.parse(text)).toEqual({
      provider: 'QONTO',
      type: 'BANKING',
      credentials: { login: 'org-login', secretKeyMasked: '••••1234', hasSecretKey: true },
    })
  })

  it('reads the Ponto client id, and shows no hint for a secret it cannot decrypt', async () => {
    db.integration.findFirst.mockResolvedValue({
      provider: 'PONTO',
      type: 'BANKING',
      credentials: { clientId: 'ponto-client', clientSecret: 'not-decryptable' },
      credentialsEncrypted: true,
    })
    const body = await (await call(credentials.GET, url, { id: 'int-1' })).json()
    expect(body.credentials).toEqual({ login: 'ponto-client', secretKeyMasked: null, hasSecretKey: false })
  })
})

describe('POST /api/integrations/[id]/features', () => {
  const url = '/api/integrations/int-1/features'

  beforeEach(integrationOfCompany1)

  it('answers 403 to an accountant', async () => {
    roles.mockResolvedValue(['accountant'])
    expect((await call(features.POST, url, { method: 'POST', id: 'int-1', body: { features: [] } })).status).toBe(403)
  })

  it.each([
    ['no list', {}, 'features: Indiquez les fonctionnalités à activer ou désactiver (features).'],
    ['an unknown feature', { features: [{ feature: 'INVOICES' }] }, 'features.0.feature: Fonctionnalité inconnue : choisissez BANKING_ACCOUNTS ou BANKING_TRANSACTIONS.'],
  ])('answers 400 for %s', async (_label, body, message) => {
    const response = await call(features.POST, url, { method: 'POST', id: 'int-1', body })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe(message)
  })

  it('answers 404 when the integration is not in the company', async () => {
    db.integration.findFirst.mockResolvedValue(null)
    const response = await call(features.POST, url, { method: 'POST', id: 'int-1', body: { features: [{ feature: 'BANKING_ACCOUNTS' }] } })
    expect(response.status).toBe(404)
    expect(db.integrationFeatureConfig.upsert).not.toHaveBeenCalled()
  })

  it('upserts each feature once (on by default) and returns the features', async () => {
    db.integration.findFirst.mockResolvedValue({ id: 'int-1' })
    db.integrationFeatureConfig.findMany.mockResolvedValue([{ feature: 'BANKING_ACCOUNTS', enabled: false }])
    const response = await call(features.POST, url, {
      method: 'POST',
      id: 'int-1',
      body: { features: [{ feature: 'BANKING_ACCOUNTS' }, { feature: 'BANKING_ACCOUNTS', enabled: false }] },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ features: [{ feature: 'BANKING_ACCOUNTS', enabled: false }] })
    expect(db.integrationFeatureConfig.upsert).toHaveBeenCalledTimes(1)
    expect(db.integrationFeatureConfig.upsert.mock.calls[0][0]).toMatchObject({
      where: { integrationId_feature: { integrationId: 'int-1', feature: 'BANKING_ACCOUNTS' } },
      update: { enabled: false },
    })
  })
})

describe('POST /api/integrations/[id]/resources', () => {
  const url = '/api/integrations/int-1/resources'

  beforeEach(integrationOfCompany1)

  it('answers 400 without resourceIds', async () => {
    const response = await call(resources.POST, url, { method: 'POST', id: 'int-1', body: {} })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('resourceIds: Indiquez les comptes à synchroniser (resourceIds).')
  })

  it('answers 404 when the integration is not in the company', async () => {
    db.integration.findFirst.mockResolvedValue(null)
    expect((await call(resources.POST, url, { method: 'POST', id: 'int-1', body: { resourceIds: [] } })).status).toBe(404)
    expect(db.integrationResource.updateMany).not.toHaveBeenCalled()
  })

  it('switches the pending resources and the bank accounts of the connection', async () => {
    db.integration.findFirst.mockResolvedValue({
      bankConnection: { id: 'conn-1' },
      resources: [
        { id: 'res-pending-on', bankAccount: null },
        { id: 'res-pending-off', bankAccount: null },
        { id: 'res-account', bankAccount: { id: 'ba-1' } },
      ],
    })
    db.bankConnection.findFirst.mockResolvedValue({
      id: 'conn-1',
      bankAccounts: [{ id: 'ba-1', supersededById: null, integrationResourceId: 'res-account' }],
    })
    db.bankAccount.findMany.mockResolvedValue([])
    const response = await call(resources.POST, url, {
      method: 'POST',
      id: 'int-1',
      body: { resourceIds: ['res-pending-on', 'res-account', 'unknown'] },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(db.integrationResource.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['res-pending-off'] } }, data: { shouldSync: false } })
    expect(db.integrationResource.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['res-pending-on'] } }, data: { shouldSync: true } })
    expect(db.bankConnection.findFirst.mock.calls[0][0]?.where).toEqual({ id: 'conn-1', companyId: 'company-1' })
    expect(db.bankAccount.update).toHaveBeenCalledWith({ where: { id: 'ba-1' }, data: { shouldSync: true } })
  })
})

describe('POST /api/integrations/[id]/sync', () => {
  const url = '/api/integrations/int-1/sync'

  beforeEach(integrationOfCompany1)

  it('answers 403 to a viewer', async () => {
    roles.mockResolvedValue(['viewer'])
    expect((await call(syncOne.POST, url, { method: 'POST', id: 'int-1' })).status).toBe(403)
    expect(sync).not.toHaveBeenCalled()
  })

  it('answers 404 when the integration is not in the company, without syncing', async () => {
    db.integration.findFirst.mockResolvedValue(null)
    const response = await call(syncOne.POST, url, { method: 'POST', id: 'int-1' })
    expect(response.status).toBe(404)
    expect(db.integration.findFirst.mock.calls[0][0]?.where).toEqual({ id: 'int-1', companyId: 'company-1' })
    expect(sync).not.toHaveBeenCalled()
  })

  it('answers 429 when the bank API limit is reached', async () => {
    vi.mocked(limitBankCalls).mockRejectedValueOnce(new RateLimitError('Trop de requêtes vers la banque. Patientez une minute.'))
    expect((await call(syncOne.POST, url, { method: 'POST', id: 'int-1' })).status).toBe(429)
    expect(sync).not.toHaveBeenCalled()
  })

  it('answers 400 for a body that is not JSON', async () => {
    expect((await call(syncOne.POST, url, { method: 'POST', id: 'int-1', rawBody: '{' })).status).toBe(400)
  })

  it('syncs the enabled features without a body, the known requested ones with one', async () => {
    db.integration.findFirst.mockResolvedValue({ id: 'int-1' })
    sync.mockResolvedValue({ success: true, itemsSynced: 3, errors: [] })
    const response = await call(syncOne.POST, url, { method: 'POST', id: 'int-1' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, itemsSynced: 3, errors: [] })
    expect(sync).toHaveBeenLastCalledWith('int-1', KEY, undefined, {})

    await call(syncOne.POST, url, { method: 'POST', id: 'int-1', body: { features: ['BANKING_TRANSACTIONS', 'INVOICES', 3] } })
    expect(sync).toHaveBeenLastCalledWith('int-1', KEY, ['BANKING_TRANSACTIONS'], {})
  })
})

describe('POST /api/integrations/sync', () => {
  const url = '/api/integrations/sync'

  it('answers 403 to a viewer', async () => {
    roles.mockResolvedValue(['viewer'])
    expect((await call(syncAll.POST, url, { method: 'POST', body: { companyId: 'company-1' } })).status).toBe(403)
  })

  it('answers 400 for a history longer than a year', async () => {
    const response = await call(syncAll.POST, url, { method: 'POST', body: { companyId: 'company-1', maxDays: 400 } })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe("maxDays: 365 jours d'historique au maximum.")
  })

  it('says when the company has no active bank connection', async () => {
    db.integration.findMany.mockResolvedValue([])
    const response = await call(syncAll.POST, url, { method: 'POST', body: { companyId: 'company-1' } })
    expect(await response.json()).toEqual({
      success: true,
      integrationsSynced: 0,
      totalItemsSynced: 0,
      errors: [],
      message: 'Aucune connexion bancaire active.',
    })
    expect(db.integration.findMany.mock.calls[0][0]?.where).toEqual({ companyId: 'company-1', status: 'active', type: 'BANKING' })
  })

  it('keeps syncing after a failing bank and never returns a provider message', async () => {
    db.integration.findMany.mockResolvedValue([
      { id: 'int-q', provider: 'QONTO' },
      { id: 'int-p', provider: 'PONTO' },
      { id: 'int-r', provider: 'REVOLUT' },
    ])
    sync
      .mockResolvedValueOnce({ success: true, itemsSynced: 4, errors: [] })
      .mockResolvedValueOnce({ success: false, itemsSynced: 0, errors: ["L'accès de Ponto à votre banque a expiré."] })
      .mockRejectedValueOnce(new Error('ECONNRESET internal provider detail'))
    const response = await call(syncAll.POST, url, { method: 'POST', body: { companyId: 'company-1', maxDays: 30 } })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('ECONNRESET')
    expect(JSON.parse(text)).toEqual({
      success: false,
      integrationsSynced: 1,
      totalItemsSynced: 4,
      errors: [
        "Ponto : L'accès de Ponto à votre banque a expiré.",
        'Revolut Business : Une erreur inattendue a interrompu la synchronisation. Réessayez dans quelques minutes.',
      ],
    })
    expect(sync).toHaveBeenCalledWith('int-q', KEY, ['BANKING_ACCOUNTS', 'BANKING_TRANSACTIONS'], { maxDays: 30 })
  })
})
