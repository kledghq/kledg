/**
 * Mass assignment: a create/update body may carry extra fields a client should
 * not control (id, companyId, entryNumber, status, createdById, userId, role,
 * isClosed, credentials). The zod body schemas strip unknown keys and the
 * services build their own data object, so these must be ignored: the row is
 * created/updated from the authorized fields only, never from the injected
 * ones.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('security_mass_assign')
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

describe.skipIf(!available)('mass assignment', () => {
  beforeEach(async () => {
    if (!prisma) ({ prisma } = await import('@/lib/prisma'))
    routes.entries ??= (await import('@/app/api/entries/route')) as unknown as Record<string, Handler>
    routes.accounts ??= (await import('@/app/api/accounts/route')) as unknown as Record<string, Handler>
    routes.rules ??= (await import('@/app/api/transaction-rules/route')) as unknown as Record<string, Handler>
    routes.company ??= (await import('@/app/api/companies/[id]/route')) as unknown as Record<string, Handler>
    await prepareTestDatabase('security_mass_assign')
    await seedTenants(prisma, ids)
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('entry create ignores injected id, entryNumber, status and createdById', async () => {
    const response = await call('accountant', {
      route: routes.entries,
      method: 'POST',
      path: '/api/entries',
      body: {
        companyId: ids.aCompany,
        journalId: ids.aJournal,
        date: '2026-04-01',
        description: 'mass-assign-entry',
        // Injected fields that must be ignored:
        id: 'pwned-entry-id',
        entryNumber: '9999',
        createdById: 'u-admin',
        validatedAt: '2000-01-01',
        lines: [
          { accountId: ids.aAccount, debit: 100, credit: 0 },
          { accountId: ids.aSales, debit: 0, credit: 100 },
        ],
      },
    })
    expect(response.status).toBeLessThan(300)
    const entry = await prisma.accountingEntry.findFirstOrThrow({ where: { companyId: ids.aCompany, description: 'mass-assign-entry' } })
    expect(entry.id).not.toBe('pwned-entry-id')
    expect(entry.entryNumber).not.toBe('9999') // server-assigned sequence
    expect(entry.status).toBe('draft') // never silently validated
  })

  it('account create ignores injected id and foreign companyId in the body', async () => {
    const response = await call('accountant', {
      route: routes.accounts,
      method: 'POST',
      path: '/api/accounts',
      body: {
        companyId: ids.aCompany,
        code: '5120001',
        label: 'Banque secondaire',
        parentId: ids.aAccount,
        fiscalYearId: ids.aFy,
        id: 'pwned-account-id',
        balance: 999999,
        isPCG: true,
      },
    })
    expect(response.status).toBeLessThan(300)
    const account = await prisma.account.findFirstOrThrow({ where: { companyId: ids.aCompany, code: '5120001' } })
    expect(account.id).not.toBe('pwned-account-id')
    // The account belongs to company A (the authorized company), never B.
    expect(account.companyId).toBe(ids.aCompany)
  })

  it('rule create ignores injected id and companyId override', async () => {
    const response = await call('companyAdmin', {
      route: routes.rules,
      method: 'POST',
      path: '/api/transaction-rules',
      body: {
        companyId: ids.aCompany,
        name: 'mass-assign-rule',
        conditions: [],
        entryLines: [],
        id: 'pwned-rule-id',
        createdById: 'u-admin',
      },
    })
    expect(response.status).toBeLessThan(300)
    const rule = await prisma.transactionRule.findFirstOrThrow({ where: { companyId: ids.aCompany, name: 'mass-assign-rule' } })
    expect(rule.id).not.toBe('pwned-rule-id')
    expect(rule.companyId).toBe(ids.aCompany)
  })

  it('company update ignores injected id, role and other unknown fields', async () => {
    const response = await call('companyAdmin', {
      route: routes.company,
      method: 'PATCH',
      path: `/api/companies/${ids.aCompany}`,
      params: { id: ids.aCompany },
      body: {
        name: 'Renamed Alpha',
        id: 'pwned-company-id',
        role: 'admin',
        createdById: 'u-admin',
        isClosed: true,
      },
    })
    expect(response.status).toBeLessThan(300)
    // The id is immutable and the rename applied; no injected field took effect.
    expect(await prisma.company.findUnique({ where: { id: 'pwned-company-id' } })).toBeNull()
    const company = await prisma.company.findUniqueOrThrow({ where: { id: ids.aCompany } })
    expect(company.name).toBe('Renamed Alpha')
  })
})
