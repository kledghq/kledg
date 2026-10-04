/**
 * Bank transaction and assignment rule routes against PostgreSQL
 * (lib/__tests__/helpers/test-db.ts), only the session mocked:
 * - list: query validation (400 in French), exact balance before the period;
 * - bulk delete, reconcile and undo: per-item French errors, other
 *   companies' ids reported as not found and left untouched, idempotent;
 * - reconcile: body shapes (new entry, existing entry, none), malformed JSON;
 * - apply a rule: typed errors (404 rule of another company, 409 already
 *   reconciled);
 * - rules: validation, duplicate, simulation errors (400, never 500),
 *   execution, rule drafts and suggestions scoped by company.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('transactions')
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
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

let prisma: Prisma
const routes: Record<string, Record<string, Handler>> = {}

const ROUTE_MODULES = {
  transactions: () => import('@/app/api/transactions/route'),
  bulkDelete: () => import('@/app/api/transactions/bulk-delete/route'),
  bulkReconcile: () => import('@/app/api/transactions/bulk-reconcile/route'),
  bulkUnreconcile: () => import('@/app/api/transactions/bulk-unreconcile/route'),
  reconcile: () => import('@/app/api/transactions/[id]/reconcile/route'),
  applyRule: () => import('@/app/api/transactions/[id]/apply-rule/route'),
  createRule: () => import('@/app/api/transactions/[id]/create-rule/route'),
  suggest: () => import('@/app/api/transactions/[id]/suggest/route'),
  rules: () => import('@/app/api/transaction-rules/route'),
  rule: () => import('@/app/api/transaction-rules/[id]/route'),
  duplicate: () => import('@/app/api/transaction-rules/[id]/duplicate/route'),
  simulate: () => import('@/app/api/transaction-rules/[id]/simulate/route'),
  simulateData: () => import('@/app/api/transaction-rules/simulate/route'),
  execute: () => import('@/app/api/transaction-rules/execute/route'),
}

const USERS = {
  admin: { id: 'u-cadmin', email: 'cadmin@test.local', name: 'Company admin', role: 'user' },
  accountant: { id: 'u-accountant', email: 'accountant@test.local', name: 'Accountant', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' },
} as const
type Who = keyof typeof USERS

const ids = {} as Record<string, string>

async function call(
  who: Who,
  route: keyof typeof ROUTE_MODULES,
  method: Method,
  path: string,
  options: { params?: Record<string, string>; body?: unknown; rawBody?: string } = {},
): Promise<Response> {
  state.user = { ...USERS[who] }
  const body = options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined ? { body, headers: { 'content-type': 'application/json' } } : {}),
  })
  return routes[route][method](request, { params: Promise.resolve(options.params ?? {}) })
}

const errorOf = async (response: Response) => ((await response.json()) as { error: string }).error

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  }
  for (const prefix of ['a', 'b'] as const) {
    const company = await prisma.company.create({
      data: { name: `Société ${prefix}`, slug: `societe-${prefix}`, siren: prefix === 'a' ? '111111111' : '222222222' },
    })
    await prisma.organization.create({
      data: { id: `org-${prefix}`, name: company.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id },
    })
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
    })
    for (const [code, label] of [
      ['512000', 'Banque'],
      ['606100', 'Fournitures'],
      ['445660', 'TVA déductible'],
    ]) {
      const account = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })
      ids[`${prefix}${code}`] = account.id
    }
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })
    const connection = await prisma.bankConnection.create({
      data: { companyId: company.id, login: `login-${prefix}`, secretKeyEncrypted: 'encrypted-secret' },
    })
    const bankAccount = await prisma.bankAccount.create({
      data: { bankConnectionId: connection.id, externalAccountId: `ext-${prefix}`, name: 'Compte courant' },
    })
    const tx = (n: number, amount: string, date: string, side: string) =>
      prisma.bankTransaction.create({
        data: {
          bankAccountId: bankAccount.id,
          externalTransactionId: `${prefix}-${n}`,
          amount,
          date: new Date(`${date}T00:00:00Z`),
          side,
          label: 'CB PAPETERIE MARTIN',
          counterpartyName: 'Papeterie Martin',
        },
      })
    // 0.1 + 0.2 is not 0.3 in floating point: the balance before must be exact
    const t1 = await tx(1, '0.10', '2026-01-05', 'credit')
    const t2 = await tx(2, '0.20', '2026-01-06', 'credit')
    const t3 = await tx(3, '120.00', '2026-03-05', 'debit')
    const t4 = await tx(4, '60.00', '2026-04-10', 'debit')
    const rule = await prisma.transactionRule.create({
      data: {
        companyId: company.id,
        name: 'Fournitures Martin',
        conditions: {
          create: [
            { conditionType: 'counterparty', operator: 'contains', value: 'Papeterie' },
            { conditionType: 'side', operator: 'equals', value: 'debit' },
            { conditionType: 'label', operator: 'contains', value: 'PAPETERIE' },
          ],
        },
        entryLines: {
          create: [{ accountCode: '606100', lineType: 'auto', amountType: 'full', order: 0, vatType: 'deductible', vatRate: 20, vatAccountCode: '445660' }],
        },
      },
    })
    const emptyRule = await prisma.transactionRule.create({ data: { companyId: company.id, name: 'Vide' } })
    Object.assign(ids, {
      [`${prefix}Company`]: company.id,
      [`${prefix}Journal`]: journal.id,
      [`${prefix}T1`]: t1.id,
      [`${prefix}T2`]: t2.id,
      [`${prefix}T3`]: t3.id,
      [`${prefix}T4`]: t4.id,
      [`${prefix}Rule`]: rule.id,
      [`${prefix}EmptyRule`]: emptyRule.id,
    })
  }
  for (const [userId, role] of [
    ['u-cadmin', 'companyAdmin'],
    ['u-accountant', 'accountant'],
    ['u-viewer', 'viewer'],
  ]) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId: 'org-a', role, createdAt: new Date() } })
  }
}

describe.skipIf(!available)('transaction and rule routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('transactions')
    ;({ prisma } = await import('@/lib/prisma'))
    for (const [name, load] of Object.entries(ROUTE_MODULES)) {
      routes[name] = (await load()) as unknown as Record<string, Handler>
    }
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('transactions')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('GET /api/transactions', () => {
    const list = (query: string) => call('viewer', 'transactions', 'GET', `/api/transactions?companyId=${ids.aCompany}${query}`)

    it('computes the balance before the period exactly, in cents', async () => {
      const response = await list('&startDate=2026-03-01&endDate=2026-12-31')
      expect(response.status).toBe(200)
      const body = (await response.json()) as { transactions: Array<{ id: string }>; balanceBefore: number }
      expect(body.balanceBefore).toBe(0.3)
      expect(body.transactions.map((t) => t.id)).toEqual([ids.aT3, ids.aT4])
    })

    it('pages with limit and cursor', async () => {
      const first = (await (await list('&limit=3')).json()) as { transactions: unknown[]; nextCursor: string }
      expect(first.transactions).toHaveLength(3)
      const next = (await (await list(`&limit=3&cursor=${first.nextCursor}`)).json()) as { transactions: Array<{ id: string }>; nextCursor?: string }
      expect(next.transactions.map((t) => t.id)).toEqual([ids.aT4])
      expect(next.nextCursor).toBeUndefined()
    })

    it.each([
      ['&side=both', /^side: /],
      ['&minAmount=beaucoup', /^minAmount: minAmount doit être un montant/],
      ['&startDate=demain', /^startDate: startDate doit être une date valide/],
      ['&reconciled=yes', /^reconciled: /],
    ])('refuses %s with a 400', async (query, message) => {
      const response = await list(query)
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toMatch(message)
    })

    it('answers 404 in French for a fiscal year of another company', async () => {
      const otherFy = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: ids.bCompany } })
      const response = await list(`&fiscalYearId=${otherFy.id}`)
      expect(response.status).toBe(404)
      expect(await errorOf(response)).toBe('Exercice introuvable')
    })
  })

  describe('bulk actions', () => {
    it('reconciles, reports per item in French and leaves other companies untouched', async () => {
      const response = await call('accountant', 'bulkReconcile', 'POST', '/api/transactions/bulk-reconcile', {
        body: { transactionIds: [ids.aT1, ids.bT1, 'missing'] },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        success: true,
        reconciled: 1,
        failed: 2,
        errors: [
          { transactionId: ids.bT1, error: 'Transaction introuvable' },
          { transactionId: 'missing', error: 'Transaction introuvable' },
        ],
      })
      expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids.bT1 } })).reconciled).toBe(false)

      const again = await call('accountant', 'bulkReconcile', 'POST', '/api/transactions/bulk-reconcile', { body: { transactionIds: [ids.aT1] } })
      expect(await again.json()).toMatchObject({ reconciled: 0, failed: 1, errors: [{ error: 'Transaction déjà rapprochée' }] })

      const undo = await call('accountant', 'bulkUnreconcile', 'POST', '/api/transactions/bulk-unreconcile', {
        body: { companyId: 'societe-a', transactionIds: [ids.aT1, ids.aT2] },
      })
      expect(await undo.json()).toMatchObject({ unreconciled: 1, failed: 1, errors: [{ transactionId: ids.aT2, error: 'Transaction non rapprochée' }] })
    })

    it('deletes only transactions of the company (company admin)', async () => {
      expect((await call('accountant', 'bulkDelete', 'POST', '/api/transactions/bulk-delete', { body: { transactionIds: [ids.aT1] } })).status).toBe(403)
      const response = await call('admin', 'bulkDelete', 'POST', '/api/transactions/bulk-delete', {
        body: { companyId: ids.aCompany, transactionIds: [ids.aT1, ids.bT1] },
      })
      expect(await response.json()).toMatchObject({ deleted: 1, failed: 1 })
      expect(await prisma.bankTransaction.count({ where: { id: { in: [ids.aT1, ids.bT1] } } })).toBe(1)
    })

    it('validates the selection in French', async () => {
      const empty = await call('accountant', 'bulkReconcile', 'POST', '/api/transactions/bulk-reconcile', { body: { companyId: ids.aCompany, transactionIds: [] } })
      expect(empty.status).toBe(400)
      expect(await errorOf(empty)).toMatch(/Sélectionnez au moins une transaction/)
      const noCompany = await call('accountant', 'bulkReconcile', 'POST', '/api/transactions/bulk-reconcile', { body: { transactionIds: [] } })
      expect(noCompany.status).toBe(400)
      expect(await errorOf(noCompany)).toBe('Sélectionnez au moins une transaction.')
    })
  })

  describe('POST /api/transactions/[id]/reconcile', () => {
    const reconcile = (id: string, options: { body?: unknown; rawBody?: string }) =>
      call('accountant', 'reconcile', 'POST', `/api/transactions/${id}/reconcile`, { params: { id }, ...options })

    it('marks the transaction reconciled without entry when the body is empty', async () => {
      const response = await reconcile(ids.aT1, {})
      expect(response.status).toBe(200)
      expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids.aT1 } })).reconciled).toBe(true)
    })

    it('refuses malformed JSON instead of reconciling', async () => {
      const response = await reconcile(ids.aT1, { rawBody: '{"lines": [' })
      expect(response.status).toBe(400)
      expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids.aT1 } })).reconciled).toBe(false)
    })

    it('reports the invalid lines of a new entry with their path', async () => {
      const response = await reconcile(ids.aT3, { body: { journalId: ids.aJournal, date: '2026-03-05', lines: [{ debit: '120.00' }] } })
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toMatch(/^lines\.0\.accountId: /)
    })

    it('refuses an entry id that is not a string', async () => {
      const response = await reconcile(ids.aT1, { body: { entryId: 12 } })
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toBe('entryId: entryId invalide')
    })
  })

  describe('POST /api/transactions/[id]/apply-rule', () => {
    const apply = (id: string, body: unknown) => call('accountant', 'applyRule', 'POST', `/api/transactions/${id}/apply-rule`, { params: { id }, body })

    it('books the draft entry, then answers 409 on a second click', async () => {
      const first = await apply(ids.aT3, { ruleId: ids.aRule })
      expect(first.status).toBe(200)
      expect(await first.json()).toMatchObject({ success: true, entryId: expect.any(String) })
      const second = await apply(ids.aT3, { ruleId: ids.aRule })
      expect(second.status).toBe(409)
      expect(await prisma.accountingEntry.count({ where: { sourceBankTransactionId: ids.aT3 } })).toBe(1)
    })

    it("answers 404 for another company's rule and 400 without a rule", async () => {
      const other = await apply(ids.aT3, { ruleId: ids.bRule })
      expect(other.status).toBe(404)
      expect(await errorOf(other)).toBe('Règle introuvable')
      expect(await errorOf(await apply(ids.aT3, {}))).toBe('ruleId: ruleId est requis')
    })
  })

  describe('rule drafts and suggestions', () => {
    it('drafts a rule from the transaction with the best rule lines resolved to accounts', async () => {
      const response = await call('viewer', 'createRule', 'GET', '/x', { params: { id: ids.aT3 } })
      expect(response.status).toBe(200)
      const draft = (await response.json()) as { suggestedName: string; suggestedEntryLines: Array<{ accountId: string; vatAccountId: string }>; matchingRules: Array<{ ruleId: string }> }
      expect(draft.suggestedName).toBe('Papeterie Martin')
      expect(draft.matchingRules.map((r) => r.ruleId)).toEqual([ids.aRule])
      expect(draft.suggestedEntryLines).toEqual([expect.objectContaining({ accountId: ids.a606100, vatAccountId: ids.a445660 })])
    })

    it('suggests matching rules from the provider data, without bank credentials', async () => {
      await prisma.bankTransaction.update({ where: { id: ids.aT3 }, data: { providerData: { clean_counterparty_name: 'Papeterie Martin' } } })
      const response = await call('viewer', 'suggest', 'GET', '/x', { params: { id: ids.aT3 } })
      const text = await response.text()
      expect(response.status).toBe(200)
      expect(text).toContain(ids.aRule)
      expect(text).not.toContain('encrypted-secret')
      expect(text).not.toContain('login-a')
    })
  })

  describe('transaction rules', () => {
    const create = (body: unknown) => call('accountant', 'rules', 'POST', '/api/transaction-rules', { body: { companyId: ids.aCompany, ...(body as object) } })

    it('creates a rule and refuses invalid lines', async () => {
      const ok = await create({
        name: 'Loyer',
        conditions: [{ conditionType: 'label', operator: 'contains', value: 'LOYER' }],
        entryLines: [{ accountCode: '613200', lineType: 'auto', amountType: 'full', amountValue: '12.5' }],
      })
      expect(ok.status).toBe(200)
      const { rule } = (await ok.json()) as { rule: { entryLines: Array<{ amountValue: string }> } }
      expect(rule.entryLines[0].amountValue).toBe('12.5')
      expect((await create({ name: 'x', entryLines: [{ accountCode: '6', lineType: 'auto', amountType: 'full', amountValue: 'abc' }] })).status).toBe(400)
      expect(await errorOf(await create({ name: '  ' }))).toBe('Donnez un nom à la règle.')
    })

    it('duplicates a rule disabled, and only rules of the company', async () => {
      const response = await call('accountant', 'duplicate', 'POST', '/x', { params: { id: ids.aRule } })
      expect(response.status).toBe(200)
      const { rule } = (await response.json()) as { rule: { name: string; enabled: boolean; conditions: unknown[]; entryLines: unknown[] } }
      expect(rule).toMatchObject({ name: 'Fournitures Martin (copie)', enabled: false })
      expect(rule.conditions).toHaveLength(3)
      expect(rule.entryLines).toHaveLength(1)
      expect((await call('accountant', 'duplicate', 'POST', '/x', { params: { id: ids.bRule } })).status).toBe(404)
    })

    it('simulates a saved rule and refuses an empty rule with a 400 in French', async () => {
      const example = { transactionExample: { amount: 120, side: 'debit' } }
      const ok = await call('viewer', 'simulate', 'POST', '/x', { params: { id: ids.aRule }, body: example })
      expect(ok.status).toBe(200)
      const empty = await call('viewer', 'simulate', 'POST', '/x', { params: { id: ids.aEmptyRule }, body: example })
      expect(empty.status).toBe(400)
      expect(await errorOf(empty)).toMatch(/aucune ligne/)
      const noAmount = await call('viewer', 'simulate', 'POST', '/x', { params: { id: ids.aRule }, body: { transactionExample: { amount: 0, side: 'debit' } } })
      expect(await errorOf(noAmount)).toMatch(/transactionExample avec amount et side requis/)
    })

    it('simulates a rule being edited', async () => {
      const body = {
        companyId: ids.aCompany,
        ruleData: { entryLines: [{ accountCode: '606100', lineType: 'auto', amountType: 'full' }] },
        transactionExample: { amount: 50, side: 'debit' },
      }
      expect((await call('viewer', 'simulateData', 'POST', '/x', { body })).status).toBe(200)
      const empty = await call('viewer', 'simulateData', 'POST', '/x', { body: { ...body, ruleData: { entryLines: [] } } })
      expect(await errorOf(empty)).toBe('ruleData.entryLines: ruleData avec entryLines requis')
    })

    it('runs the rules engine on the given transactions of the company only', async () => {
      const response = await call('accountant', 'execute', 'POST', '/x', {
        body: { companyId: ids.aCompany, transactionIds: [ids.aT3, ids.bT3], autoApply: true },
      })
      expect(response.status).toBe(200)
      expect(((await response.json()) as { results: { applied: number } }).results.applied).toBe(1)
      expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids.bT3 } })).reconciled).toBe(false)
      expect((await call('accountant', 'execute', 'POST', '/x', { body: { companyId: ids.aCompany, autoApply: 'yes' } })).status).toBe(400)
    })

    it('replaces and deletes a rule of the company only', async () => {
      const put = await call('accountant', 'rule', 'PUT', '/x', { params: { id: ids.aRule }, body: { name: 'Renommée', enabled: false } })
      expect(put.status).toBe(200)
      expect(await put.json()).toMatchObject({ rule: { name: 'Renommée', enabled: false, conditions: [], entryLines: [] } })
      expect((await call('viewer', 'rule', 'DELETE', '/x', { params: { id: ids.aRule } })).status).toBe(403)
      expect((await call('accountant', 'rule', 'DELETE', '/x', { params: { id: ids.aRule } })).status).toBe(200)
    })
  })
})
