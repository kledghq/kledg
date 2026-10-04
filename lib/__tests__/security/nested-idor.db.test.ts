/**
 * Nested IDOR: a request authorized for company A that carries an object id
 * belonging to company B inside its body or query (accountId, journalId,
 * entryId, ruleId, transactionId...) must be refused, not silently acted on.
 *
 * The authorization matrix already covers cross-company reconcile, depreciation
 * and entry-account cases; this adds the create-entry and apply-rule vectors
 * through the tenant-A actor against tenant-B ids.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('security_idor')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  return { user: null as unknown }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { makeCall, seedTenants, type Handler } from './helpers/tenants'

const available = await testDatabaseAvailable()
const call = makeCall(state)
const ids = {} as Record<string, string>
let prisma: typeof import('@/lib/prisma').prisma
const routes: Record<string, Record<string, Handler>> = {}

describe.skipIf(!available)('nested IDOR (foreign object ids in the body)', () => {
  beforeEach(async () => {
    if (!prisma) ({ prisma } = await import('@/lib/prisma'))
    routes.entries ??= (await import('@/app/api/entries/route')) as unknown as Record<string, Handler>
    routes.applyRule ??= (await import('@/app/api/transactions/[id]/apply-rule/route')) as unknown as Record<string, Handler>
    routes.reconcile ??= (await import('@/app/api/transactions/[id]/reconcile/route')) as unknown as Record<string, Handler>
    await prepareTestDatabase('security_idor')
    await seedTenants(prisma, ids)
    state.user = null
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('refuses an entry in A that references company B accounts', async () => {
    const response = await call('accountant', {
      route: routes.entries,
      method: 'POST',
      path: '/api/entries',
      body: {
        companyId: ids.aCompany,
        journalId: ids.aJournal,
        date: '2026-04-01',
        description: 'idor-foreign-accounts',
        lines: [
          { accountId: ids.bAccount, debit: 100, credit: 0 },
          { accountId: ids.bSales, debit: 0, credit: 100 },
        ],
      },
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany, description: 'idor-foreign-accounts' } })).toBe(0)
    // And nothing was created under B either.
    expect(await prisma.accountingEntry.count({ where: { companyId: ids.bCompany, description: 'idor-foreign-accounts' } })).toBe(0)
  })

  it('refuses an entry in A that uses company B journal', async () => {
    const response = await call('accountant', {
      route: routes.entries,
      method: 'POST',
      path: '/api/entries',
      body: {
        companyId: ids.aCompany,
        journalId: ids.bJournal,
        date: '2026-04-01',
        description: 'idor-foreign-journal',
        lines: [
          { accountId: ids.aAccount, debit: 100, credit: 0 },
          { accountId: ids.aSales, debit: 0, credit: 100 },
        ],
      },
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.accountingEntry.count({ where: { description: 'idor-foreign-journal' } })).toBe(0)
  })

  it("refuses applying company B's rule to company A's transaction", async () => {
    const response = await call('accountant', {
      route: routes.applyRule,
      method: 'POST',
      path: `/api/transactions/${ids.aTransaction}/apply-rule`,
      params: { id: ids.aTransaction },
      body: { ruleId: ids.bRule },
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it("refuses reconciling company A's transaction with company B's entry", async () => {
    const response = await call('accountant', {
      route: routes.reconcile,
      method: 'POST',
      path: `/api/transactions/${ids.aTransaction}/reconcile`,
      params: { id: ids.aTransaction },
      body: { entryId: ids.bEntry },
    })
    expect(response.status).toBe(404)
    expect((await prisma.bankTransaction.findUnique({ where: { id: ids.aTransaction } }))?.reconciledWith).toBeNull()
  })
})
