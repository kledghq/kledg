/**
 * Settings of a connection on the Banque page, against PostgreSQL:
 * - the per-account sync switch writes both flags, the sync honours it,
 *   superseded, manual and disconnected accounts cannot be turned on;
 * - a reconnection shows the account as synced again;
 * - the Qonto API key update checks the new key first, keeps the stored
 *   secret when none is typed, never returns it and reactivates the
 *   connection.
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('bank_account_settings')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { BankAuthorizationError } from '@/lib/banking/errors'
import type { BankProvider, ProviderTransaction } from '@/lib/banking/providers/types'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: Prisma
let service: typeof import('@/lib/banking/connections.service')
let syncIntegration: typeof import('@/lib/integrations/sync').syncIntegration
let accountRoute: Record<'PUT', Handler>
let key: string

const ids = {} as Record<string, string>
const ADMIN = { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'user' }
const NOW = new Date('2026-09-20T08:00:00Z')

function fakeQonto(): BankProvider {
  const line: ProviderTransaction = {
    externalId: 'q-1',
    accountExternalId: 'FR7616958000016543210987654',
    amount: 12.5,
    side: 'debit',
    date: new Date('2026-09-10T00:00:00Z'),
    state: 'booked',
    status: 'completed',
  }
  return {
    id: 'QONTO',
    kind: 'direct',
    listAccounts: async () => [{ externalId: 'FR7616958000016543210987654', iban: 'FR7616958000016543210987654', name: 'main-1', currency: 'EUR', balance: 10 }],
    syncTransactions: async () => [line],
    getBalances: async () => [],
    getConnectionHealth: async () => ({ lastSyncAt: null, consentExpiresAt: null, error: null }),
  }
}

async function seed() {
  const { sealCredentials } = await import('@/lib/banking/credentials')
  await prisma.user.create({ data: { id: ADMIN.id, email: ADMIN.email, name: ADMIN.name, role: ADMIN.role } })
  const company = await prisma.company.create({ data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111' } })
  await prisma.organization.create({ data: { id: 'org-a', name: company.name, slug: 'org-a', createdAt: new Date(), companyId: company.id } })
  await prisma.member.create({ data: { id: 'm-a', userId: ADMIN.id, organizationId: 'org-a', role: 'companyAdmin', createdAt: new Date() } })
  const qonto = await prisma.integration.create({
    data: {
      companyId: company.id,
      provider: 'QONTO',
      type: 'BANKING',
      name: 'Qonto',
      status: 'active',
      credentials: sealCredentials('QONTO', { login: 'atelier-1234', secretKey: 'old-secret-1111' }, key) as object,
      credentialsEncrypted: true,
      featureConfigs: { create: [{ feature: 'BANKING_ACCOUNTS' }, { feature: 'BANKING_TRANSACTIONS' }] },
    },
  })
  const manual = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL' } })
  const manualAccount = await prisma.bankAccount.create({ data: { bankConnectionId: manual.id, externalAccountId: 'manual:1', name: 'Caisse', shouldSync: false } })
  Object.assign(ids, { company: company.id, qonto: qonto.id, manualAccount: manualAccount.id })
}

const sync = () => syncIntegration(ids.qonto, key, undefined, { provider: fakeQonto(), now: NOW })
const qontoAccount = () => prisma.bankAccount.findFirstOrThrow({ where: { bankConnection: { companyId: ids.company, provider: 'QONTO' } } })

describe.skipIf(!available)('Banque page settings', () => {
  beforeAll(async () => {
    await prepareTestDatabase('bank_account_settings')
    ;({ prisma } = await import('@/lib/prisma'))
    service = await import('@/lib/banking/connections.service')
    ;({ syncIntegration } = await import('@/lib/integrations/sync'))
    accountRoute = (await import('@/app/api/banking/accounts/[id]/route')) as unknown as typeof accountRoute
    key = (await import('@/lib/crypto/encryption-key')).getEncryptionKey()!
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('bank_account_settings')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('per-account sync switch', () => {
    it('stops and resumes the sync of one account, through the route', async () => {
      await sync()
      const account = await qontoAccount()
      state.user = { ...ADMIN }
      const put = (shouldSync: boolean) =>
        accountRoute.PUT(
          new NextRequest(`http://localhost/api/banking/accounts/${account.id}`, {
            method: 'PUT',
            body: JSON.stringify({ shouldSync }),
            headers: { 'content-type': 'application/json' },
          }),
          { params: Promise.resolve({ id: account.id }) },
        )

      const off = await put(false)
      expect(off.status).toBe(200)
      expect((await off.json()).account.shouldSync).toBe(false)
      expect((await prisma.integrationResource.findUniqueOrThrow({ where: { id: account.integrationResourceId! } })).shouldSync).toBe(false)

      // The sync skips it: a new line is not read
      await prisma.bankTransaction.deleteMany({ where: { bankAccountId: account.id } })
      await sync()
      expect(await prisma.bankTransaction.count({ where: { bankAccountId: account.id } })).toBe(0)
      // and the account sync keeps it off
      expect((await qontoAccount()).shouldSync).toBe(false)

      expect((await put(true)).status).toBe(200)
      await sync()
      expect(await prisma.bankTransaction.count({ where: { bankAccountId: account.id } })).toBe(1)
    })

    it('refuses to turn on a manual, superseded or disconnected account', async () => {
      await expect(service.setBankAccountSync(ids.company, ids.manualAccount, true)).rejects.toThrow(/relevés importés/)

      await sync()
      const account = await qontoAccount()
      const pontoConnection = await prisma.bankConnection.create({ data: { companyId: ids.company, provider: 'PONTO' } })
      const superseded = await prisma.bankAccount.create({
        data: { bankConnectionId: pontoConnection.id, externalAccountId: 'p-1', name: 'Via Ponto', supersededById: account.id, shouldSync: false },
      })
      await expect(service.setBankAccountSync(ids.company, superseded.id, true)).rejects.toThrow(/connexion directe/)

      await service.disconnectConnection(account.bankConnectionId, ids.company)
      await expect(service.setBankAccountSync(ids.company, account.id, true)).rejects.toThrow(/déconnectée/)
    })

    it("answers 404 for another company's account", async () => {
      const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '222222222' } })
      await expect(service.setBankAccountSync(other.id, ids.manualAccount, false)).rejects.toThrow('Compte bancaire non trouvé')
    })

    it('shows a reconnected account as synced again', async () => {
      await sync()
      const account = await qontoAccount()
      await service.disconnectConnection(account.bankConnectionId, ids.company)
      expect((await qontoAccount()).shouldSync).toBe(false)
      const { sealCredentials } = await import('@/lib/banking/credentials')
      const again = await prisma.integration.create({
        data: {
          companyId: ids.company,
          provider: 'QONTO',
          type: 'BANKING',
          name: 'Qonto',
          status: 'active',
          credentials: sealCredentials('QONTO', { login: 'atelier-1234', secretKey: 'new' }, key) as object,
          credentialsEncrypted: true,
          featureConfigs: { create: [{ feature: 'BANKING_ACCOUNTS' }, { feature: 'BANKING_TRANSACTIONS' }] },
        },
      })
      await syncIntegration(again.id, key, undefined, { provider: fakeQonto(), now: NOW })
      expect((await qontoAccount()).shouldSync).toBe(true)
    })
  })

  describe('Qonto API key update', () => {
    it('checks the new key, stores it sealed and reactivates the connection', async () => {
      await sync()
      await prisma.integration.update({ where: { id: ids.qonto }, data: { status: 'error' } })
      await prisma.bankConnection.updateMany({ where: { integrationId: ids.qonto }, data: { lastSyncError: "Qonto refuse l'accès", secretKeyEncrypted: 'legacy', login: 'old' } })
      const seen: Array<Record<string, unknown>> = []
      await service.updateIntegrationCredentials({
        companyId: ids.company,
        integrationId: ids.qonto,
        credentials: { login: 'atelier-1234', secretKey: ' new-secret-9999 ' },
        encryptionKey: key,
        verify: async (_provider, credentials) => seen.push(credentials),
      })
      expect(seen).toEqual([{ login: 'atelier-1234', secretKey: 'new-secret-9999' }])
      const integration = await prisma.integration.findUniqueOrThrow({ where: { id: ids.qonto } })
      expect(integration.status).toBe('active')
      expect(JSON.stringify(integration.credentials)).not.toContain('new-secret-9999')
      const { openCredentials } = await import('@/lib/banking/credentials')
      expect(openCredentials('QONTO', integration.credentials, true, key)).toMatchObject({ secretKey: 'new-secret-9999' })
      // The legacy key no longer shadows the new one
      expect(await prisma.bankConnection.findFirstOrThrow({ where: { integrationId: ids.qonto } })).toMatchObject({
        secretKeyEncrypted: '',
        login: 'atelier-1234',
        lastSyncError: null,
        status: 'active',
      })
    })

    it('keeps the stored secret when none is typed', async () => {
      const seen: Array<Record<string, unknown>> = []
      await service.updateIntegrationCredentials({
        companyId: ids.company,
        integrationId: ids.qonto,
        credentials: { login: 'atelier-5678', secretKey: '' },
        encryptionKey: key,
        verify: async (_provider, credentials) => seen.push(credentials),
      })
      expect(seen).toEqual([{ login: 'atelier-5678', secretKey: 'old-secret-1111' }])
    })

    it('refuses a key Qonto rejects, in French, and changes nothing', async () => {
      const before = await prisma.integration.findUniqueOrThrow({ where: { id: ids.qonto } })
      await expect(
        service.updateIntegrationCredentials({
          companyId: ids.company,
          integrationId: ids.qonto,
          credentials: { login: 'atelier-1234', secretKey: 'wrong' },
          encryptionKey: key,
          verify: async () => {
            throw new BankAuthorizationError('refused')
          },
        }),
      ).rejects.toThrow('Qonto refuse ces identifiants')
      expect((await prisma.integration.findUniqueOrThrow({ where: { id: ids.qonto } })).credentials).toEqual(before.credentials)
    })

    it("answers 404 for another company's connection", async () => {
      const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '222222222' } })
      await expect(
        service.updateIntegrationCredentials({ companyId: other.id, integrationId: ids.qonto, credentials: {}, encryptionKey: key, verify: async () => [] }),
      ).rejects.toThrow('Connexion bancaire introuvable')
    })
  })
})
