/**
 * The 512 account of a bank account created by a sync (lib/banking/ledger-account.ts,
 * pickLedgerCodeForBankAccount): mapped when there is no choice to make (the
 * company's default bank account, or its only euro 512 account), left
 * for an explicit choice otherwise, and never changed on an existing account.
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('bank_sync_ledger_mapping')
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { BankProvider, ProviderAccount } from '@/lib/banking/providers/types'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
let prisma: Prisma
let syncIntegration: typeof import('@/lib/integrations/sync').syncIntegration

const NOW = new Date('2026-09-20T08:00:00Z')
const ids = {} as Record<string, string>

function fakeQonto(accounts: ProviderAccount[]): BankProvider {
  return {
    id: 'QONTO',
    kind: 'direct',
    listAccounts: async () => accounts,
    syncTransactions: async () => [],
    getBalances: async () => [],
    getConnectionHealth: async () => ({ lastSyncAt: null, consentExpiresAt: null, error: null }),
  }
}

const main: ProviderAccount = {
  externalId: 'FR7616958000011234567890143',
  iban: 'FR7616958000011234567890143',
  name: 'atelier-lumen-compte-principal',
  currency: 'EUR',
  balance: 1000,
}

async function seed(codes: string[], defaultBankAccountCode: string | null = null) {
  const company = await prisma.company.create({
    data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111', defaultBankAccountCode },
  })
  const fiscalYear = await prisma.fiscalYear.create({
    data: {
      companyId: company.id,
      year: 2026,
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2026-12-31T00:00:00Z'),
    },
  })
  for (const code of codes) {
    await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fiscalYear.id, code, label: `Banque ${code}` } })
  }
  const qonto = await prisma.integration.create({
    data: {
      companyId: company.id,
      provider: 'QONTO',
      type: 'BANKING',
      name: 'Qonto',
      status: 'active',
      credentials: { login: 'org' },
      credentialsEncrypted: false,
      featureConfigs: { create: [{ feature: 'BANKING_ACCOUNTS' }] },
    },
  })
  Object.assign(ids, { company: company.id, qonto: qonto.id })
}

const syncAccounts = (accounts: ProviderAccount[]) =>
  syncIntegration(ids.qonto, 'unused-key', ['BANKING_ACCOUNTS' as never], { provider: fakeQonto(accounts), now: NOW })

const mapping = async (externalAccountId = main.externalId) =>
  (await prisma.bankAccount.findFirstOrThrow({ where: { externalAccountId }, select: { ledgerAccountCode: true } })).ledgerAccountCode

describe.skipIf(!available)('bank sync: 512 account of a new bank account', () => {
  beforeAll(async () => {
    await prepareTestDatabase('bank_sync_ledger_mapping')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ syncIntegration } = await import('@/lib/integrations/sync'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('bank_sync_ledger_mapping')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('maps the only euro 512 account (the parent 512 and 5124 devises do not count)', async () => {
    await seed(['512', '5121', '5124'])
    expect((await syncAccounts([main])).errors).toEqual([])
    expect(await mapping()).toBe('5121')
  })

  it('maps the only detailed 512 account', async () => {
    await seed(['512', '512000'])
    expect((await syncAccounts([main])).errors).toEqual([])
    expect(await mapping()).toBe('512000')
  })

  it('maps the default bank account of the company among several', async () => {
    await seed(['512000', '512100'], '512100')
    await syncAccounts([main])
    expect(await mapping()).toBe('512100')
  })

  it('leaves the choice explicit with several 512 accounts and no default', async () => {
    await seed(['512000', '512100'])
    await syncAccounts([main])
    expect(await mapping()).toBeNull()
  })

  it('never changes the mapping of an account that already exists', async () => {
    await seed(['512000'])
    await syncAccounts([main])
    await prisma.bankAccount.updateMany({ data: { ledgerAccountCode: null } })
    await syncAccounts([main, { ...main, externalId: 'second', iban: 'FR7616958000019999999999999', name: 'second-account' }])
    expect(await mapping()).toBeNull()
    expect(await mapping('second')).toBe('512000')
  })
})
