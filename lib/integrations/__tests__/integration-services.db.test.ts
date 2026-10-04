/**
 * Integration services behind app/api/integrations/**, against PostgreSQL:
 * - one integration per company and provider, even for concurrent creations
 *   (advisory lock), secrets encrypted at rest, never returned;
 * - every lookup is scoped by company (another company's integration is a 404);
 * - features and synced resources change only the integration's own rows.
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('integration_services')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { BankProvider } from '@/lib/banking/providers/types'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
let prisma: Prisma
let create: typeof import('@/lib/integrations/create-integration.service')
let list: typeof import('@/lib/integrations/list-integrations.service')
let masked: typeof import('@/lib/integrations/read-masked-credentials.service')
let features: typeof import('@/lib/integrations/set-integration-features.service')
let resources: typeof import('@/lib/integrations/select-synced-resources.service')
let syncs: typeof import('@/lib/integrations/sync-company-integrations.service')
let key: string

const ids = {} as Record<string, string>
const SECRET = 'qonto-secret-key-0123456789'

function fakeQonto(): BankProvider {
  return {
    id: 'QONTO',
    kind: 'direct',
    listAccounts: async () => [{ externalId: 'FR7616958000016543210987654', iban: 'FR7616958000016543210987654', name: 'main-1', currency: 'EUR', balance: 10 }],
    syncTransactions: async () => [],
    getBalances: async () => [],
    getConnectionHealth: async () => ({ lastSyncAt: null, consentExpiresAt: null, error: null }),
  }
}

async function seed() {
  const a = await prisma.company.create({ data: { name: 'Atelier Alpha', slug: 'atelier-alpha', siren: '111111111' } })
  const b = await prisma.company.create({ data: { name: 'Bureau Beta', slug: 'bureau-beta', siren: '222222222' } })
  const ponto = await prisma.integration.create({
    data: {
      companyId: b.id,
      provider: 'PONTO',
      type: 'BANKING',
      name: 'Ponto',
      credentials: { clientId: 'ponto-b', clientSecret: 'ponto-secret-b' },
      metadata: { oauth: { stateHash: 'hash' } },
      featureConfigs: { create: [{ feature: 'BANKING_ACCOUNTS' }] },
    },
  })
  Object.assign(ids, { a: a.id, b: b.id, pontoB: ponto.id })
}

const qontoInput = () =>
  create.CreateIntegrationSchema.parse({
    provider: 'QONTO',
    type: 'BANKING',
    credentials: { login: 'alpha-login', secretKey: SECRET },
    features: ['BANKING_ACCOUNTS', 'BANKING_TRANSACTIONS'],
  })

describe.skipIf(!available)('integration services', () => {
  beforeAll(async () => {
    await prepareTestDatabase('integration_services')
    ;({ prisma } = await import('@/lib/prisma'))
    create = await import('@/lib/integrations/create-integration.service')
    list = await import('@/lib/integrations/list-integrations.service')
    masked = await import('@/lib/integrations/read-masked-credentials.service')
    features = await import('@/lib/integrations/set-integration-features.service')
    resources = await import('@/lib/integrations/select-synced-resources.service')
    syncs = await import('@/lib/integrations/sync-company-integrations.service')
    key = (await import('@/lib/crypto/encryption-key')).getEncryptionKey()!
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('integration_services')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('createIntegration', () => {
    it('stores the secret encrypted with its features and returns no credentials', async () => {
      const integration = await create.createIntegration(ids.a, qontoInput(), key)
      expect(Object.keys(integration)).not.toContain('credentials')
      expect(integration).toMatchObject({ companyId: ids.a, provider: 'QONTO', name: 'Qonto', status: 'active' })

      const row = await prisma.integration.findUniqueOrThrow({ where: { id: integration.id }, include: { featureConfigs: true } })
      expect(row.credentialsEncrypted).toBe(true)
      expect(JSON.stringify(row.credentials)).not.toContain(SECRET)
      expect(row.featureConfigs.map((f) => f.feature).sort()).toEqual(['BANKING_ACCOUNTS', 'BANKING_TRANSACTIONS'])
    })

    it('creates one integration per provider even when two requests race', async () => {
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => create.createIntegration(ids.a, qontoInput(), key)))
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find((r) => r.status === 'rejected')
      expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ statusCode: 409 })
      expect(await prisma.integration.count({ where: { companyId: ids.a, provider: 'QONTO' } })).toBe(1)
    })

    it('lets another company connect the same provider', async () => {
      await create.createIntegration(ids.a, create.CreateIntegrationSchema.parse({ provider: 'PONTO', type: 'BANKING', credentials: { clientId: 'x', clientSecret: 'y' } }), key)
      expect(await prisma.integration.count({ where: { provider: 'PONTO' } })).toBe(2)
    })
  })

  describe('listIntegrations', () => {
    it("lists only the company's integrations, without credentials nor metadata", async () => {
      await create.createIntegration(ids.a, qontoInput(), key)
      expect(await list.listIntegrations(ids.a)).toHaveLength(1)

      const [ponto] = await list.listIntegrations(ids.b)
      expect(ponto.id).toBe(ids.pontoB)
      expect(Object.keys(ponto)).not.toContain('credentials')
      expect(Object.keys(ponto)).not.toContain('metadata')
      expect(JSON.stringify(ponto)).not.toContain('ponto-secret-b')
      expect(ponto.featureConfigs.map((f) => f.feature)).toEqual(['BANKING_ACCOUNTS'])
    })
  })

  describe('readMaskedCredentials', () => {
    it('masks the secret and answers 404 for another company', async () => {
      const integration = await create.createIntegration(ids.a, qontoInput(), key)
      expect(await masked.readMaskedCredentials(ids.a, integration.id)).toEqual({
        provider: 'QONTO',
        type: 'BANKING',
        credentials: { login: 'alpha-login', secretKeyMasked: '••••6789', hasSecretKey: true },
      })
      await expect(masked.readMaskedCredentials(ids.a, ids.pontoB)).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('setIntegrationFeatures', () => {
    it('upserts the listed features, clears a config, and refuses another company', async () => {
      const result = await features.setIntegrationFeatures(
        ids.b,
        ids.pontoB,
        features.SetIntegrationFeaturesSchema.parse({
          features: [{ feature: 'BANKING_ACCOUNTS', enabled: false }, { feature: 'BANKING_TRANSACTIONS', config: { days: 30 } }],
        }),
      )
      expect(result.map((f) => [f.feature, f.enabled, f.config])).toEqual([
        ['BANKING_ACCOUNTS', false, null],
        ['BANKING_TRANSACTIONS', true, { days: 30 }],
      ])
      await expect(
        features.setIntegrationFeatures(ids.a, ids.pontoB, features.SetIntegrationFeaturesSchema.parse({ features: [{ feature: 'BANKING_ACCOUNTS' }] })),
      ).rejects.toMatchObject({ statusCode: 404 })
      expect(await prisma.integrationFeatureConfig.count({ where: { integrationId: ids.pontoB, enabled: false } })).toBe(1)
    })
  })

  describe('selectSyncedResources', () => {
    it('switches pending resources and linked bank accounts of this integration only', async () => {
      const [pendingOn, pendingOff, linked] = await Promise.all(
        ['on', 'off', 'linked'].map((name) =>
          prisma.integrationResource.create({
            data: { integrationId: ids.pontoB, resourceType: 'bank_account', externalId: name, name, data: {}, shouldSync: name !== 'on' },
          }),
        ),
      )
      const connection = await prisma.bankConnection.create({ data: { companyId: ids.b, provider: 'PONTO', integrationId: ids.pontoB } })
      const account = await prisma.bankAccount.create({
        data: { bankConnectionId: connection.id, externalAccountId: 'linked', name: 'Compte', shouldSync: false, integrationResourceId: linked.id },
      })

      await expect(resources.selectSyncedResources(ids.a, ids.pontoB, { resourceIds: [pendingOn.id] })).rejects.toMatchObject({ statusCode: 404 })

      expect(await resources.selectSyncedResources(ids.b, ids.pontoB, { resourceIds: [pendingOn.id, linked.id, 'unknown'] })).toEqual({ success: true })
      const states = await prisma.integrationResource.findMany({ where: { integrationId: ids.pontoB }, select: { id: true, shouldSync: true } })
      expect(Object.fromEntries(states.map((s) => [s.id, s.shouldSync]))).toEqual({ [pendingOn.id]: true, [pendingOff.id]: false, [linked.id]: true })
      expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: account.id } })).shouldSync).toBe(true)
    })
  })

  describe('syncCompanyIntegration', () => {
    it('syncs an integration of the company and refuses one of another company', async () => {
      const integration = await create.createIntegration(ids.a, qontoInput(), key)
      await expect(syncs.syncCompanyIntegration(ids.a, ids.pontoB, undefined, { encryptionKey: key, provider: fakeQonto() })).rejects.toMatchObject({
        statusCode: 404,
      })
      const result = await syncs.syncCompanyIntegration(ids.a, integration.id, syncs.SyncIntegrationSchema.parse({ features: ['BANKING_ACCOUNTS'] }), { encryptionKey: key, provider: fakeQonto() })
      expect(result).toMatchObject({ success: true, errors: [] })
      expect(await prisma.bankAccount.count({ where: { bankConnection: { companyId: ids.a } } })).toBe(1)
    })
  })
})
