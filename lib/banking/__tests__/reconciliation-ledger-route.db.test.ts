/**
 * GET /api/banking/reconciliation against PostgreSQL: the entries it lists
 * are those of the bank ledger account (PCG art. 512) of the bank account,
 * resolved like everywhere else (lib/banking/ledger-account.ts), never the
 * first account whose code starts with 51 (the parent 51 or 512, a 511).
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('bank_reconciliation')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let route: Record<'GET' | 'DELETE', Handler>
const ids = {} as Record<string, string>
const USER = { id: 'u-accountant', email: 'accountant@test.local', name: 'Accountant', role: 'user' }

async function seed() {
  await prisma.user.create({ data: { id: USER.id, email: USER.email, name: USER.name, role: USER.role } })
  const company = await prisma.company.create({ data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111' } })
  await prisma.organization.create({ data: { id: 'org-a', name: company.name, slug: 'org-a', createdAt: new Date(), companyId: company.id } })
  await prisma.member.create({ data: { id: 'm-a', userId: USER.id, organizationId: 'org-a', role: 'accountant', createdAt: new Date() } })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
  })
  const account = (code: string, label: string) => prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })
  // Parents first: a prefix match on "51" returned one of these
  await account('51', 'Banques, établissements financiers et assimilés')
  await account('511', 'Valeurs à l’encaissement')
  await account('512', 'Banques')
  const main = await account('512000', 'Banque principale')
  const savings = await account('512100', 'Banque Qonto')
  const supplies = await account('606100', 'Fournitures')
  const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })

  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL' } })
  const mapped = await prisma.bankAccount.create({
    data: { bankConnectionId: connection.id, externalAccountId: 'manual:1', name: 'Compte Qonto', ledgerAccountCode: '512100' },
  })
  const unmapped = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'manual:2', name: 'Compte principal' } })
  const transaction = await prisma.bankTransaction.create({
    data: { bankAccountId: mapped.id, externalTransactionId: 'tx-1', amount: '-12.34', date: new Date('2026-03-06T00:00:00Z'), side: 'debit', label: 'Papeterie' },
  })
  ids.transaction = transaction.id

  let n = 0
  const entry = async (bankAccountId: string, debitCents: number, date: string) => {
    n++
    const number = `BR-${n}`
    const created = await prisma.accountingEntry.create({
      data: { companyId: company.id, fiscalYearId: fy.id, journalId: journal.id, entryNumber: number, date: new Date(`${date}T00:00:00Z`), description: `Écriture ${n}` },
    })
    const amount = (debitCents / 100).toFixed(2)
    await prisma.entryLine.createMany({
      data: [
        { accountingEntryId: created.id, accountingEntryNumber: number, accountId: bankAccountId, accountFiscalYearId: fy.id, debit: amount, credit: 0 },
        { accountingEntryId: created.id, accountingEntryNumber: number, accountId: supplies.id, accountFiscalYearId: fy.id, debit: 0, credit: amount },
      ],
    })
    return created.id
  }
  Object.assign(ids, {
    company: company.id,
    mapped: mapped.id,
    unmapped: unmapped.id,
    mainEntry: await entry(main.id, 12_345, '2026-03-05'),
    savingsEntry: await entry(savings.id, 10, '2026-03-06'),
    savingsEntry2: await entry(savings.id, 20, '2026-04-06'),
  })
}

async function get(query: Record<string, string>) {
  state.user = { ...USER }
  const params = new URLSearchParams({ companyId: ids.company, includeTransactions: 'false', ...query })
  const response = await route.GET(new NextRequest(`http://localhost/api/banking/reconciliation?${params}`))
  return { status: response.status, body: await response.json() }
}

describe.skipIf(!available)('GET /api/banking/reconciliation: bank ledger account', () => {
  beforeAll(async () => {
    await prepareTestDatabase('bank_reconciliation')
    ;({ prisma } = await import('@/lib/prisma'))
    route = (await import('@/app/api/banking/reconciliation/route')) as unknown as typeof route
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('bank_reconciliation')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it("uses the bank account's own 512 mapping, not the parent 51", async () => {
    const { status, body } = await get({ bankAccountId: ids.mapped })
    expect(status).toBe(200)
    expect(body.bankAccount).toMatchObject({ code: '512100' })
    expect(body.accountingEntries.map((e: { id: string }) => e.id).sort()).toEqual([ids.savingsEntry, ids.savingsEntry2].sort())
  })

  it('falls back to the first detailed 512 account for an unmapped bank account', async () => {
    const { body } = await get({ bankAccountId: ids.unmapped })
    expect(body.bankAccount).toMatchObject({ code: '512000' })
    expect(body.accountingEntries).toHaveLength(1)
    expect(body.accountingEntries[0]).toMatchObject({ id: ids.mainEntry, totalDebit: 123.45, totalCredit: 0 })
  })

  it('without a bank account, lists the entries of every bank ledger account in use', async () => {
    const { body } = await get({})
    expect(body.ledgerAccounts.map((a: { code: string }) => a.code)).toEqual(['512000', '512100'])
    expect(body.accountingEntries).toHaveLength(3)
  })

  it('filters by calendar days and refuses an invalid period', async () => {
    const { body } = await get({ bankAccountId: ids.mapped, startDate: '2026-03-06', endDate: '2026-03-06' })
    expect(body.accountingEntries.map((e: { id: string }) => e.id)).toEqual([ids.savingsEntry])
    const iso = await get({ bankAccountId: ids.mapped, startDate: '2026-04-01T00:00:00.000Z', endDate: '2026-04-30T23:59:59.999Z' })
    expect(iso.body.accountingEntries.map((e: { id: string }) => e.id)).toEqual([ids.savingsEntry2])
    expect((await get({ startDate: '06/03/2026', endDate: '2026-03-06' })).status).toBe(400)
  })

  it('lists the transactions of the company, with the former qontoAccountId filter, unless includeTransactions=false', async () => {
    const { body } = await get({ includeTransactions: 'true', qontoAccountId: ids.mapped })
    expect(body.transactions).toEqual([
      expect.objectContaining({ id: ids.transaction, amount: -12.34, date: '2026-03-06T00:00:00.000Z', reconciled: false }),
    ])
    expect(body.bankAccount).toMatchObject({ code: '512100' })
    expect((await get({ includeTransactions: 'true', bankAccountId: ids.unmapped })).body.transactions).toEqual([])
    expect((await get({})).body.transactions).toEqual([])
  })

  it('DELETE validates its query: transactionId required, unknown transaction is a 404', async () => {
    state.user = { ...USER }
    const del = async (query: string) => {
      const response = await route.DELETE(new NextRequest(`http://localhost/api/banking/reconciliation${query}`, { method: 'DELETE' }))
      return { status: response.status, error: ((await response.json()) as { error?: string }).error }
    }
    expect(await del('')).toEqual({ status: 400, error: 'Précisez la transaction (transactionId).' })
    expect(await del('?transactionId=missing')).toEqual({ status: 404, error: 'Transaction introuvable' })
    expect((await del(`?transactionId=${ids.transaction}`)).status).toBe(409)
  })
})
