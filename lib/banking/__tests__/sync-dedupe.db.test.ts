/**
 * Bank sync against PostgreSQL, the provider replaced by a fake (no network):
 * - a direct connection (Qonto) replacing a Ponto account for the same IBAN
 *   does not insert the operations Ponto already brought: they are recorded
 *   as matches, count aware (two coffees stay two, a third one is new);
 * - an API sync overlapping a statement file imported into the account
 *   records the overlap instead of inserting it;
 * - a retried, concurrent or partly failed sync creates nothing twice.
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('bank_sync_dedupe')
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { BankProvider, ProviderAccount, ProviderTransaction } from '@/lib/banking/providers/types'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
let prisma: Prisma
let syncIntegration: typeof import('@/lib/integrations/sync').syncIntegration

const IBAN = 'FR7616958000016543210987654'
const NOW = new Date('2026-09-20T08:00:00Z')
const ids = {} as Record<string, string>

function qontoLine(id: string, cents: number, day: string, over: Partial<ProviderTransaction> = {}): ProviderTransaction {
  return {
    externalId: id,
    accountExternalId: IBAN,
    amount: Math.abs(cents) / 100,
    side: cents < 0 ? 'debit' : 'credit',
    date: new Date(`${day}T00:00:00Z`),
    valueDate: day,
    state: 'booked',
    status: 'completed',
    label: `Qonto ${id}`,
    ...over,
  }
}

/** A Qonto provider answering fixed lines; `fail` makes the transactions call throw once. */
function fakeQonto(lines: () => ProviderTransaction[], options: { fail?: boolean } = {}): BankProvider {
  let fail = options.fail ?? false
  const account: ProviderAccount = { externalId: IBAN, iban: IBAN, name: 'main-1', currency: 'EUR', balance: 1000 }
  return {
    id: 'QONTO',
    kind: 'direct',
    listAccounts: async () => [account],
    syncTransactions: async () => {
      if (fail) {
        fail = false
        throw new TypeError('socket hang up')
      }
      return lines()
    },
    getBalances: async () => [],
    getConnectionHealth: async () => ({ lastSyncAt: null, consentExpiresAt: null, error: null }),
  }
}

async function seed() {
  const company = await prisma.company.create({ data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111' } })
  // Ponto reached the account first and synced its lines
  const ponto = await prisma.integration.create({
    data: { companyId: company.id, provider: 'PONTO', type: 'BANKING', name: 'Ponto', credentials: {}, credentialsEncrypted: false },
  })
  const pontoConnection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'PONTO', integrationId: ponto.id } })
  const pontoAccount = await prisma.bankAccount.create({
    data: { bankConnectionId: pontoConnection.id, externalAccountId: 'ponto-acc-1', iban: 'FR76 1695 8000 0165 4321 0987 654', name: 'Compte via Ponto' },
  })
  const pontoLine = (id: string, cents: number, day: string, valueDate = day) =>
    prisma.bankTransaction.create({
      data: {
        bankAccountId: pontoAccount.id,
        externalTransactionId: id,
        amount: (Math.abs(cents) / 100).toFixed(2),
        side: cents < 0 ? 'debit' : 'credit',
        date: new Date(`${day}T00:00:00Z`),
        label: `Ponto ${id}`,
        status: 'booked',
        providerData: { valueDate: `${valueDate}T00:00:00.000Z` },
      },
    })
  await pontoLine('p-coffee-1', -350, '2026-09-01')
  await pontoLine('p-coffee-2', -350, '2026-09-01')
  // Booked by the bank a day after Qonto's created_at, same value day
  await pontoLine('p-rent', -120_000, '2026-09-03', '2026-09-02')
  await pontoLine('p-old', 5000, '2026-07-01')

  const qonto = await prisma.integration.create({
    data: {
      companyId: company.id,
      provider: 'QONTO',
      type: 'BANKING',
      name: 'Qonto',
      status: 'active',
      credentials: { login: 'org' },
      credentialsEncrypted: false,
      featureConfigs: { create: [{ feature: 'BANKING_ACCOUNTS' }, { feature: 'BANKING_TRANSACTIONS' }] },
    },
  })
  Object.assign(ids, { company: company.id, pontoAccount: pontoAccount.id, qonto: qonto.id })
}

const baseLines = () => [
  qontoLine('q-coffee-1', -350, '2026-09-01'),
  qontoLine('q-coffee-2', -350, '2026-09-01'),
  qontoLine('q-coffee-3', -350, '2026-09-01'),
  qontoLine('q-rent', -120_000, '2026-09-02'),
  qontoLine('q-new', 9_999, '2026-09-10'),
  // Declined at Qonto: stored with its status, never matched
  qontoLine('q-declined', 5000, '2026-07-01', { state: 'rejected', status: 'declined' }),
]

const sync = (provider: BankProvider) =>
  syncIntegration(ids.qonto, 'unused-key', undefined, { provider, now: NOW })

const qontoAccount = () =>
  prisma.bankAccount.findFirstOrThrow({ where: { bankConnection: { companyId: ids.company, provider: 'QONTO' } } })

async function qontoIds() {
  const account = await qontoAccount()
  const rows = await prisma.bankTransaction.findMany({ where: { bankAccountId: account.id }, select: { externalTransactionId: true } })
  return rows.map((r) => r.externalTransactionId).sort()
}

describe.skipIf(!available)('bank sync: cross-source duplicates and retries', () => {
  beforeAll(async () => {
    await prepareTestDatabase('bank_sync_dedupe')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ syncIntegration } = await import('@/lib/integrations/sync'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('bank_sync_dedupe')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('records the operations the replaced Ponto account already holds instead of inserting them', async () => {
    const result = await sync(fakeQonto(baseLines))
    expect(result.errors).toEqual([])
    // The Ponto account is superseded by the Qonto one (same IBAN)
    const qonto = await qontoAccount()
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: ids.pontoAccount } })).supersededById).toBe(qonto.id)

    // Two coffees and the rent were already there; the third coffee, the new line and the declined one are inserted
    expect(await qontoIds()).toEqual(['q-coffee-3', 'q-declined', 'q-new'])
    // itemsSynced counts the account, then the inserted lines
    expect(result).toMatchObject({ itemsSynced: 1 + 3, matched: 3 })
    const matches = await prisma.bankTransactionMatch.findMany({
      where: { bankAccountId: qonto.id },
      select: { externalTransactionId: true, bankTransaction: { select: { externalTransactionId: true } } },
      orderBy: { externalTransactionId: 'asc' },
    })
    expect(matches.map((m) => [m.externalTransactionId, m.bankTransaction.externalTransactionId])).toEqual([
      ['q-coffee-1', 'p-coffee-1'],
      ['q-coffee-2', 'p-coffee-2'],
      ['q-rent', 'p-rent'],
    ])
  })

  it('is idempotent: a retried sync creates and matches nothing more', async () => {
    await sync(fakeQonto(baseLines))
    const second = await sync(fakeQonto(baseLines))
    expect(second).toMatchObject({ success: true, itemsSynced: 1, matched: 0 })
    expect(await qontoIds()).toEqual(['q-coffee-3', 'q-declined', 'q-new'])
    expect(await prisma.bankTransactionMatch.count()).toBe(3)
    expect(await prisma.bankTransaction.count()).toBe(4 + 3)
  })

  it('creates nothing twice when two syncs of the same account run at once', async () => {
    // Accounts first, so both runs write transactions to the same account
    await syncIntegration(ids.qonto, 'unused-key', ['BANKING_ACCOUNTS' as never], { provider: fakeQonto(() => []), now: NOW })
    const results = await Promise.all([sync(fakeQonto(baseLines)), sync(fakeQonto(baseLines)), sync(fakeQonto(baseLines))])
    expect(results.every((r) => r.success)).toBe(true)
    expect(results.reduce((n, r) => n + r.itemsSynced, 0)).toBe(3 + 3)
    expect(results.reduce((n, r) => n + (r.matched ?? 0), 0)).toBe(3)
    expect(await qontoIds()).toEqual(['q-coffee-3', 'q-declined', 'q-new'])
    expect(await prisma.bankTransactionMatch.count()).toBe(3)
  })

  it('stores everything once after a run that failed while reading the transactions', async () => {
    const failed = await sync(fakeQonto(baseLines, { fail: true }))
    expect(failed.success).toBe(false)
    // The reason shown is French, never the library message
    expect(failed.errors.join(' ')).not.toContain('socket hang up')
    expect((await qontoAccount()).lastSyncError).toMatch(/erreur inattendue/)
    const retried = await sync(fakeQonto(baseLines))
    expect(retried).toMatchObject({ success: true, itemsSynced: 1 + 3, matched: 3 })
    expect((await qontoAccount()).lastSyncError).toBeNull()
  })

  it('records the overlap with a statement file imported into the account', async () => {
    await syncIntegration(ids.qonto, 'unused-key', ['BANKING_ACCOUNTS' as never], { provider: fakeQonto(() => []), now: NOW })
    const account = await qontoAccount()
    const file = await prisma.bankTransaction.create({
      data: {
        bankAccountId: account.id,
        externalTransactionId: 'import:abc:0',
        amount: '99.99',
        side: 'credit',
        date: new Date('2026-09-10T00:00:00Z'),
        label: 'VIR CLIENT',
        imported: true,
        status: 'completed',
        providerData: { source: 'file-import', format: 'csv' },
      },
    })
    const result = await sync(fakeQonto(() => [qontoLine('q-new', 9_999, '2026-09-10'), qontoLine('q-other', 9_999, '2026-09-11')]))
    expect(result).toMatchObject({ itemsSynced: 1 + 1, matched: 1 })
    expect(await qontoIds()).toEqual(['import:abc:0', 'q-other'])
    expect(await prisma.bankTransactionMatch.findUnique({ where: { bankTransactionId: file.id } })).toMatchObject({ externalTransactionId: 'q-new' })
  })

  it('reports incomplete or unreadable stored credentials in French, without calling the bank', async () => {
    const incomplete = await syncIntegration(ids.qonto, 'a'.repeat(64), undefined, { now: NOW })
    expect(incomplete.errors).toEqual(["Les identifiants Qonto sont incomplets : saisissez l'identifiant et la clé secrète."])
    await prisma.integration.update({ where: { id: ids.qonto }, data: { credentials: { login: 'org', secretKey: 'not-sealed' }, credentialsEncrypted: true } })
    const unreadable = await syncIntegration(ids.qonto, 'a'.repeat(64), undefined, { now: NOW })
    expect(unreadable.errors).toEqual(['Les identifiants enregistrés de cette banque ne peuvent plus être lus : reconnectez-la depuis la page Banque.'])
  })

  it("never matches a line the provider stored itself: identical operations stay distinct", async () => {
    await sync(fakeQonto(() => [qontoLine('q-a', -700, '2026-09-15')]))
    const result = await sync(fakeQonto(() => [qontoLine('q-a', -700, '2026-09-15'), qontoLine('q-b', -700, '2026-09-15')]))
    expect(result).toMatchObject({ itemsSynced: 1 + 1, matched: 0 })
    expect(await qontoIds()).toEqual(['q-a', 'q-b'])
  })
})
