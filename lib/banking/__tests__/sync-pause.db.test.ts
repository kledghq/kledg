/**
 * Bank sync of read-only companies (GitHub issue #15), against PostgreSQL,
 * the provider replaced by a fake (no network):
 * - an archived company, or one the instance policy makes read-only
 *   (companyWriteRefusal), is not synced: the bank is not called, nothing is
 *   recorded, the last sync date stays;
 * - the daily sync skips it and syncs the other companies;
 * - the company's manual sync answers why it is paused, once;
 * - once writable again, the next sync reads from the last sync date, so the
 *   paused period is caught up.
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const policy = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('bank_sync_pause')
  return { readOnly: new Set<string>() }
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/instance/policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instance/policy')>()),
  companyWriteRefusal: async (companyId: string) =>
    policy.readOnly.has(companyId)
      ? { message: 'Abonnement impayé\u00a0: la société est en lecture seule.', link: { label: 'Choisir une offre', href: '/billing' } }
      : null,
}))
// The daily sync builds its providers from the stored credentials: a fake answers instead.
const provider = vi.hoisted(() => ({ calls: [] as Array<{ account: string; since?: Date }> }))
vi.mock('@/lib/banking/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/banking/providers')>()
  return { ...actual, createBankProvider: () => fakeQonto() }
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { BankProvider } from '@/lib/banking/providers/types'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
let prisma: Prisma
let syncIntegration: typeof import('@/lib/integrations/sync').syncIntegration
let syncAllBankIntegrations: typeof import('@/lib/banking/sync-banks.service').syncAllBankIntegrations
let syncCompanyIntegrations: typeof import('@/lib/integrations/sync-company-integrations.service').syncCompanyIntegrations

const IBAN = 'FR7616958000016543210987654'
const LAST_SYNC = new Date('2026-07-01T06:00:00Z')
const NOW = new Date('2026-09-20T08:00:00Z')
const ids = {} as Record<string, string>

function fakeQonto(): BankProvider {
  return {
    id: 'QONTO',
    kind: 'direct',
    listAccounts: async () => [{ externalId: IBAN, iban: IBAN, name: 'main-1', currency: 'EUR', balance: 1000 }],
    syncTransactions: async (account, since) => {
      provider.calls.push({ account, since })
      return [
        {
          externalId: 'q-during-pause',
          accountExternalId: IBAN,
          amount: 42,
          side: 'debit',
          date: new Date('2026-08-15T00:00:00Z'),
          valueDate: '2026-08-15',
          state: 'booked',
          status: 'completed',
          label: 'Paid while read-only',
        },
      ]
    },
    getBalances: async () => [],
    getConnectionHealth: async () => ({ lastSyncAt: null, consentExpiresAt: null, error: null }),
  }
}

async function seedCompany(name: string, slug: string, siren: string) {
  const company = await prisma.company.create({ data: { name, slug, siren } })
  const integration = await prisma.integration.create({
    data: {
      companyId: company.id,
      provider: 'QONTO',
      type: 'BANKING',
      name: 'Qonto',
      status: 'active',
      lastSyncAt: LAST_SYNC,
      credentials: { login: 'org' },
      credentialsEncrypted: false,
      featureConfigs: { create: [{ feature: 'BANKING_ACCOUNTS' }, { feature: 'BANKING_TRANSACTIONS' }] },
    },
  })
  return { company: company.id, integration: integration.id }
}

const lastSyncAt = async (integrationId: string) =>
  (await prisma.integration.findUniqueOrThrow({ where: { id: integrationId }, select: { lastSyncAt: true } })).lastSyncAt
const transactions = (companyId: string) => prisma.bankTransaction.count({ where: { bankAccount: { bankConnection: { companyId } } } })
const sync = (integrationId: string) => syncIntegration(integrationId, 'unused-key', undefined, { provider: fakeQonto(), now: NOW })

describe.skipIf(!available)('bank sync of read-only companies (issue #15)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('bank_sync_pause')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ syncIntegration } = await import('@/lib/integrations/sync'))
    ;({ syncAllBankIntegrations } = await import('@/lib/banking/sync-banks.service'))
    ;({ syncCompanyIntegrations } = await import('@/lib/integrations/sync-company-integrations.service'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('bank_sync_pause')
    policy.readOnly.clear()
    provider.calls.length = 0
    const a = await seedCompany('Atelier Lumen', 'atelier-lumen', '111111111')
    const b = await seedCompany('Studio Nord', 'studio-nord', '222222222')
    Object.assign(ids, { a: a.company, aIntegration: a.integration, b: b.company, bIntegration: b.integration })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('does not sync an archived company, records nothing, and catches up from the last sync once restored', async () => {
    await prisma.company.update({ where: { id: ids.a }, data: { archivedAt: new Date('2026-07-10T00:00:00Z') } })

    const paused = await sync(ids.aIntegration)
    expect(paused).toMatchObject({ success: false, paused: true, itemsSynced: 0 })
    expect(paused.errors[0]).toMatch(/^Synchronisation bancaire suspendue : Cette société est archivée/)
    expect(provider.calls).toEqual([])
    expect(await lastSyncAt(ids.aIntegration)).toEqual(LAST_SYNC)
    expect(await prisma.bankConnection.count({ where: { companyId: ids.a } })).toBe(0)

    await prisma.company.update({ where: { id: ids.a }, data: { archivedAt: null } })
    const resumed = await sync(ids.aIntegration)
    expect(resumed).toMatchObject({ success: true, errors: [] })
    expect(resumed.paused).toBeUndefined()
    // Read from the day of the last sync: the operation of the paused period is imported
    expect(provider.calls).toEqual([{ account: IBAN, since: new Date('2026-07-01T00:00:00Z') }])
    expect(await transactions(ids.a)).toBe(1)
    expect(await lastSyncAt(ids.aIntegration)).toEqual(NOW)
  })

  it('pauses a company the instance policy makes read-only, and resumes when the policy lifts it', async () => {
    policy.readOnly.add(ids.a)
    const paused = await sync(ids.aIntegration)
    expect(paused).toMatchObject({ success: false, paused: true })
    expect(paused.errors[0]).toContain('Abonnement impayé')
    expect(provider.calls).toEqual([])

    policy.readOnly.delete(ids.a)
    expect(await sync(ids.aIntegration)).toMatchObject({ success: true })
    expect(await transactions(ids.a)).toBe(1)
  })

  it('the daily sync skips read-only companies and syncs the others', async () => {
    policy.readOnly.add(ids.a)
    const results = await syncAllBankIntegrations('unused-key')
    const byCompany = Object.fromEntries(results.map((r) => [r.companyId, r]))
    expect(byCompany[ids.a]).toMatchObject({ paused: true, success: true, itemsSynced: 0, errors: [] })
    expect(byCompany[ids.b]).toMatchObject({ success: true })
    expect(byCompany[ids.b].paused).toBeUndefined()
    expect(await transactions(ids.a)).toBe(0)
    expect(await lastSyncAt(ids.aIntegration)).toEqual(LAST_SYNC)
    expect(await lastSyncAt(ids.bIntegration)).not.toEqual(LAST_SYNC)
    expect(await prisma.auditLog.count({ where: { companyId: ids.b, action: 'cron.bank-sync' } })).toBe(1)
    // No audit row for a skipped company: nothing ran
    expect(await prisma.auditLog.count({ where: { companyId: ids.a, action: 'cron.bank-sync' } })).toBe(0)
  })

  it("the company's manual sync answers why it is paused, once, without calling the bank", async () => {
    await prisma.company.update({ where: { id: ids.a }, data: { archivedAt: new Date() } })
    const outcome = await syncCompanyIntegrations(ids.a, {}, { encryptionKey: 'unused-key', provider: fakeQonto() })
    expect(outcome).toMatchObject({ success: false, paused: true, integrationsSynced: 0, totalItemsSynced: 0 })
    expect(outcome.errors).toHaveLength(1)
    expect(provider.calls).toEqual([])
  })
})
