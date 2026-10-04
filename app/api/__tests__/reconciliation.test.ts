/**
 * Reconciliation routes against PostgreSQL (lib/__tests__/helpers/test-db.ts),
 * only the session mocked: permissions, validation, atomicity, idempotency
 * (409 on an already reconciled transaction), undo, concurrent double
 * submits and the rules engine run twice. Skipped without the test database.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('reconcile')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

// Archived companies are read-only (lib/companies/archive-company.service.ts): none here.
vi.mock('@/lib/companies/archive-company.service', () => ({ assertCompanyWritable: async () => undefined }))
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let reconcileRoute: Record<'GET' | 'POST' | 'DELETE', Handler>
let applyRuleRoute: Record<'POST', Handler>
let processTransactions: typeof import('@/lib/services/transactions/transaction-processing-service').processTransactions

const USERS = {
  accountant: { id: 'u-accountant', email: 'accountant@test.local', name: 'Accountant', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' },
  memberB: { id: 'u-member-b', email: 'b@test.local', name: 'Member of B', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const ids = {} as Record<string, string>

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name ?? '', role: user.role } })
  }

  for (const prefix of ['a', 'b'] as const) {
    const company = await prisma.company.create({
      data: { name: `Société ${prefix}`, slug: `societe-${prefix}`, siren: prefix === 'a' ? '111111111' : '222222222' },
    })
    await prisma.organization.create({
      data: { id: `org-${prefix}`, name: company.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id },
    })
    const closed = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z'), isClosed: true },
    })
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
    })
    const account = (code: string, label: string, fiscalYearId = fy.id) =>
      prisma.account.create({ data: { companyId: company.id, fiscalYearId, code, label } })
    const bank = await account('512000', 'Banque')
    const supplies = await account('606100', 'Fournitures')
    const vat = await account('445660', 'TVA déductible')
    const customers = await account('411000', 'Clients')
    const suppliesClosed = await account('606100', 'Fournitures', closed.id)
    await account('512000', 'Banque', closed.id)
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })
    const connection = await prisma.bankConnection.create({
      data: { companyId: company.id, login: `login-${prefix}`, secretKeyEncrypted: 'encrypted-secret' },
    })
    const bankAccount = await prisma.bankAccount.create({
      data: { bankConnectionId: connection.id, externalAccountId: `ext-${prefix}`, name: 'Compte courant' },
    })
    const transaction = (external: string, amount: number, date: string, side: string, counterpartyName: string) =>
      prisma.bankTransaction.create({
        data: { bankAccountId: bankAccount.id, externalTransactionId: external, amount, date: new Date(`${date}T00:00:00Z`), side, label: `CB ${counterpartyName.toUpperCase()}`, counterpartyName },
      })
    const purchase = await transaction(`${prefix}-1`, 120, '2026-03-05', 'debit', 'Papeterie Martin')
    const other = await transaction(`${prefix}-2`, 60, '2026-04-10', 'debit', 'Papeterie Martin')
    const old = await transaction(`${prefix}-3`, 50, '2025-12-20', 'debit', 'Garage Dupont')
    Object.assign(ids, {
      [`${prefix}Company`]: company.id,
      [`${prefix}Fy`]: fy.id,
      [`${prefix}Bank`]: bank.id,
      [`${prefix}Supplies`]: supplies.id,
      [`${prefix}Vat`]: vat.id,
      [`${prefix}Customers`]: customers.id,
      [`${prefix}SuppliesClosed`]: suppliesClosed.id,
      [`${prefix}Journal`]: journal.id,
      [`${prefix}Tx`]: purchase.id,
      [`${prefix}Tx2`]: other.id,
      [`${prefix}TxClosed`]: old.id,
      [`${prefix}BankAccount`]: bankAccount.id,
    })
  }

  const members: Array<[string, string, string]> = [
    ['u-accountant', 'org-a', 'accountant'],
    ['u-viewer', 'org-a', 'viewer'],
    ['u-member-b', 'org-b', 'companyAdmin'],
  ]
  for (const [userId, organizationId, role] of members) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }
}

async function call(who: Who, method: 'GET' | 'POST' | 'DELETE', transactionId: string, body?: unknown) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  const request = new NextRequest(`http://localhost/api/transactions/${transactionId}/reconcile`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
  return reconcileRoute[method](request, { params: Promise.resolve({ id: transactionId }) })
}

/** A valid entry for the 120,00 € purchase of company A: 100,00 supplies + 20,00 VAT. */
const validBody = (overrides: Record<string, unknown> = {}) => ({
  journalId: ids.aJournal,
  date: '2026-03-05',
  description: 'Fournitures de bureau',
  lines: [
    { accountId: ids.aSupplies, debit: '100.00', credit: null },
    { accountId: ids.aVat, debit: '20.00', credit: null },
  ],
  ...overrides,
})

const entriesOf = (transactionId: string) => prisma.accountingEntry.count({ where: { sourceBankTransactionId: transactionId } })
const transaction = (id: string) => prisma.bankTransaction.findUniqueOrThrow({ where: { id } })

describe.skipIf(!available)('reconciliation routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('reconcile')
    ;({ prisma } = await import('@/lib/prisma'))
    reconcileRoute = (await import('@/app/api/transactions/[id]/reconcile/route')) as unknown as typeof reconcileRoute
    applyRuleRoute = (await import('@/app/api/transactions/[id]/apply-rule/route')) as unknown as typeof applyRuleRoute
    ;({ processTransactions } = await import('@/lib/services/transactions/transaction-processing-service'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('reconcile')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('access', () => {
    it('answers 401 to anonymous requests', async () => {
      expect((await call('anonymous', 'GET', ids.aTx)).status).toBe(401)
      expect((await call('anonymous', 'POST', ids.aTx, validBody())).status).toBe(401)
    })

    it('lets a viewer read the dialog context but not reconcile or undo (403)', async () => {
      expect((await call('viewer', 'GET', ids.aTx)).status).toBe(200)
      const post = await call('viewer', 'POST', ids.aTx, validBody())
      expect(post.status).toBe(403)
      expect((await post.json()).error).toMatch(/Action non autorisée/)
      await prisma.bankTransaction.update({ where: { id: ids.aTx }, data: { reconciled: true } })
      expect((await call('viewer', 'DELETE', ids.aTx)).status).toBe(403)
      expect(await prisma.accountingEntry.count()).toBe(0)
    })

    it('answers 404 to a member of another company, for every method', async () => {
      expect((await call('memberB', 'GET', ids.aTx)).status).toBe(404)
      expect((await call('memberB', 'POST', ids.aTx, validBody())).status).toBe(404)
      expect((await call('memberB', 'DELETE', ids.aTx)).status).toBe(404)
      expect((await transaction(ids.aTx)).reconciled).toBe(false)
    })
  })

  describe('reconcile with a new entry', () => {
    it('creates the entry with the locked bank line and marks the transaction, atomically', async () => {
      const response = await call('accountant', 'POST', ids.aTx, validBody())
      expect(response.status).toBe(201)
      const { entryId } = (await response.json()) as { entryId: string }

      const entry = await prisma.accountingEntry.findUniqueOrThrow({
        where: { id: entryId },
        include: { lines: { include: { account: true } } },
      })
      expect(entry.sourceBankTransactionId).toBe(ids.aTx)
      expect(entry.status).toBe('draft')
      expect(entry.fiscalYearId).toBe(ids.aFy)
      expect(entry.date.toISOString()).toBe('2026-03-05T00:00:00.000Z')
      const lines = entry.lines
        .map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)])
        .sort((x, y) => x[0].localeCompare(y[0]))
      expect(lines).toEqual([
        ['445660', '20.00', '0.00'],
        ['512000', '0.00', '120.00'],
        ['606100', '100.00', '0.00'],
      ])

      const tx = await transaction(ids.aTx)
      expect(tx.reconciled).toBe(true)
      expect(tx.reconciledWith).toBe(entryId)
    })

    it('ignores a bank line sent by the client: the server builds it from the transaction', async () => {
      const response = await call('accountant', 'POST', ids.aTx, validBody({
        lines: [
          { accountId: ids.aSupplies, debit: '100.00' },
          { accountId: ids.aVat, debit: '20.00' },
          { accountId: ids.aBank, credit: '1.00' },
        ],
      }))
      // The extra bank line unbalances the entry: refused, nothing written
      expect(response.status).toBe(400)
      expect(await prisma.accountingEntry.count()).toBe(0)
    })

    it('answers 409 when the transaction is already reconciled, and creates nothing', async () => {
      expect((await call('accountant', 'POST', ids.aTx, validBody())).status).toBe(201)
      const again = await call('accountant', 'POST', ids.aTx, validBody())
      expect(again.status).toBe(409)
      expect((await again.json()).error).toMatch(/déjà rapprochée/)
      expect(await entriesOf(ids.aTx)).toBe(1)
    })

    it('refuses an unbalanced entry (400) without writing anything', async () => {
      const response = await call('accountant', 'POST', ids.aTx, validBody({
        lines: [{ accountId: ids.aSupplies, debit: '100.00' }, { accountId: ids.aVat, debit: '19.99' }],
      }))
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/n'est pas équilibrée.*écart 0,01/)
      expect(await prisma.accountingEntry.count()).toBe(0)
      expect((await transaction(ids.aTx)).reconciled).toBe(false)
    })

    it('refuses a date in a closed fiscal year (400)', async () => {
      const response = await call('accountant', 'POST', ids.aTxClosed, {
        journalId: ids.aJournal,
        date: '2025-12-20',
        lines: [{ accountId: ids.aSuppliesClosed, debit: '50.00' }],
      })
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/L'exercice 2025 est clôturé/)
      expect((await transaction(ids.aTxClosed)).reconciled).toBe(false)
    })

    it('refuses accounts of another fiscal year than the date (400)', async () => {
      const response = await call('accountant', 'POST', ids.aTx, validBody({
        lines: [{ accountId: ids.aSuppliesClosed, debit: '120.00' }],
      }))
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/hors de l'exercice 2026/)
    })

    it("answers 404 for another company's account, and writes nothing", async () => {
      const response = await call('accountant', 'POST', ids.aTx, validBody({
        lines: [{ accountId: ids.bSupplies, debit: '100.00' }, { accountId: ids.aVat, debit: '20.00' }],
      }))
      expect(response.status).toBe(404)
      expect(await prisma.accountingEntry.count()).toBe(0)
      expect((await transaction(ids.aTx)).reconciled).toBe(false)
    })

    it("answers 404 for another company's journal", async () => {
      expect((await call('accountant', 'POST', ids.aTx, validBody({ journalId: ids.bJournal }))).status).toBe(404)
    })

    it('refuses a line without account, a US date and a malformed amount (400)', async () => {
      const noAccount = await call('accountant', 'POST', ids.aTx, validBody({ lines: [{ accountId: '', debit: '120.00' }] }))
      expect(noAccount.status).toBe(400)
      expect((await noAccount.json()).error).toMatch(/Choisissez un compte/)

      expect((await call('accountant', 'POST', ids.aTx, validBody({ date: '03/05/2026' }))).status).toBe(400)
      expect((await call('accountant', 'POST', ids.aTx, validBody({ date: '2026-02-30' }))).status).toBe(400)

      const comma = await call('accountant', 'POST', ids.aTx, validBody({
        lines: [{ accountId: ids.aSupplies, debit: '120,00' }],
      }))
      expect(comma.status).toBe(400)
      const tooPrecise = await call('accountant', 'POST', ids.aTx, validBody({
        lines: [{ accountId: ids.aSupplies, debit: '119.999' }, { accountId: ids.aVat, debit: '0.001' }],
      }))
      expect(tooPrecise.status).toBe(400)
      expect(await prisma.accountingEntry.count()).toBe(0)
    })

    it('refuses VAT above 20 % of the base (400)', async () => {
      const response = await call('accountant', 'POST', ids.aTx, validBody({
        lines: [{ accountId: ids.aSupplies, debit: '90.00' }, { accountId: ids.aVat, debit: '30.00' }],
      }))
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/dépasse 20 %/)
    })
  })

  describe('concurrency', () => {
    it('creates exactly one entry when the same transaction is submitted 8 times at once', async () => {
      state.user = { ...USERS.accountant }
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => call('accountant', 'POST', ids.aTx, validBody())),
      )
      const statuses = responses.map((r) => r.status).sort()
      expect(statuses.filter((s) => s === 201)).toHaveLength(1)
      expect(statuses.filter((s) => s === 409)).toHaveLength(7)
      expect(await entriesOf(ids.aTx)).toBe(1)
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany } })).toBe(1)
      expect(await prisma.entryLine.count()).toBe(3)
    })

    it('creates drafts with provisional numbers for concurrent reconciliations, numbered at validation', async () => {
      const [first, second] = await Promise.all([
        call('accountant', 'POST', ids.aTx, validBody()),
        call('accountant', 'POST', ids.aTx2, validBody({
          date: '2026-04-10',
          lines: [{ accountId: ids.aSupplies, debit: '50.00' }, { accountId: ids.aVat, debit: '10.00' }],
        })),
      ])
      expect([first.status, second.status]).toEqual([201, 201])
      const entries = await prisma.accountingEntry.findMany({ select: { entryNumber: true, status: true } })
      // Drafts like every other draft of the entries list: the definitive number comes at validation (PCG art. 1031-3)
      expect(entries.map((e) => e.status)).toEqual(['draft', 'draft'])
      expect(entries.every((e) => e.entryNumber.startsWith('BR-'))).toBe(true)
      expect(new Set(entries.map((e) => e.entryNumber)).size).toBe(2)
      expect(await first.json()).toMatchObject({ status: 'draft' })
    })
  })

  describe('undo (DELETE)', () => {
    it('deletes the draft entry the reconciliation created and unmarks the transaction', async () => {
      const { entryId } = await (await call('accountant', 'POST', ids.aTx, validBody())).json()
      const response = await call('accountant', 'DELETE', ids.aTx)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ deletedEntryId: entryId, unlinkedEntryId: null })
      expect(await prisma.accountingEntry.findUnique({ where: { id: entryId } })).toBeNull()
      expect(await prisma.entryLine.count()).toBe(0)
      const tx = await transaction(ids.aTx)
      expect([tx.reconciled, tx.reconciledWith, tx.reconciledAt]).toEqual([false, null, null])

      // Undone twice: nothing left to undo
      expect((await call('accountant', 'DELETE', ids.aTx)).status).toBe(409)
      // And it can be reconciled again
      expect((await call('accountant', 'POST', ids.aTx, validBody())).status).toBe(201)
    })

    it('refuses (409) when the entry has been validated, and changes nothing', async () => {
      const { entryId } = await (await call('accountant', 'POST', ids.aTx, validBody())).json()
      await prisma.accountingEntry.update({ where: { id: entryId }, data: { status: 'validated', entryNumber: '1' } })
      const response = await call('accountant', 'DELETE', ids.aTx)
      expect(response.status).toBe(409)
      expect((await response.json()).error).toMatch(/est validée/)
      expect(await prisma.accountingEntry.findUnique({ where: { id: entryId } })).not.toBeNull()
      expect((await transaction(ids.aTx)).reconciled).toBe(true)
    })

    it('keeps an entry that was only linked to the transaction', async () => {
      const manual = await prisma.accountingEntry.create({
        data: { companyId: ids.aCompany, fiscalYearId: ids.aFy, journalId: ids.aJournal, entryNumber: '99', date: new Date('2026-03-05T00:00:00Z') },
      })
      expect((await call('accountant', 'POST', ids.aTx, { entryId: manual.id })).status).toBe(200)
      expect((await call('accountant', 'POST', ids.aTx, { entryId: manual.id })).status).toBe(409)

      const response = await call('accountant', 'DELETE', ids.aTx)
      expect(await response.json()).toMatchObject({ deletedEntryId: null, unlinkedEntryId: manual.id })
      expect(await prisma.accountingEntry.findUnique({ where: { id: manual.id } })).not.toBeNull()
      expect((await transaction(ids.aTx)).reconciled).toBe(false)
    })

    it("refuses to link another company's entry (404)", async () => {
      const foreign = await prisma.accountingEntry.create({
        data: { companyId: ids.bCompany, fiscalYearId: ids.bFy, journalId: ids.bJournal, entryNumber: '1', date: new Date('2026-03-05T00:00:00Z') },
      })
      expect((await call('accountant', 'POST', ids.aTx, { entryId: foreign.id })).status).toBe(404)
      expect((await transaction(ids.aTx)).reconciled).toBe(false)
    })
  })

  describe('dialog context and suggestions', () => {
    it('returns the locked bank line, fiscal years and no suggestion for a new counterparty', async () => {
      const response = await call('accountant', 'GET', ids.aTx)
      const context = await response.json()
      expect(context.transaction).toMatchObject({ amountCents: 12000, side: 'debit', date: '2026-03-05', counterpartyName: 'Papeterie Martin' })
      expect(context.bankLine).toEqual({ debitCents: 0, creditCents: 12000 })
      expect(context.bankAccount).toEqual({ code: '512000', label: 'Banque' })
      expect(context.fiscalYearId).toBe(ids.aFy)
      expect(context.fiscalYears.map((fy: { year: number; isClosed: boolean }) => [fy.year, fy.isClosed])).toEqual([
        [2025, true],
        [2026, false],
      ])
      expect(context.suggestion).toBeNull()
    })

    it('suggests the accounts and VAT rate of the last reconciliation with the same counterparty, scaled', async () => {
      expect((await call('accountant', 'POST', ids.aTx, validBody())).status).toBe(201)
      const context = await (await call('accountant', 'GET', ids.aTx2)).json()
      expect(context.suggestion).toMatchObject({ source: 'history', vatRatePercent: 20, fromTransactionId: ids.aTx })
      expect(context.suggestion.title).toMatch(/Papeterie Martin \(05\/03\/2026\)/)
      expect(context.suggestion.lines.map((l: { accountCode: string; debitCents: number }) => [l.accountCode, l.debitCents])).toEqual([
        ['606100', 5000],
        ['445660', 1000],
      ])
    })

    it('prefers a matching rule', async () => {
      await createRule()
      const context = await (await call('accountant', 'GET', ids.aTx)).json()
      expect(context.suggestion).toMatchObject({ source: 'rule', vatRatePercent: 20 })
      expect(context.suggestion.title).toMatch(/Fournitures Martin/)
      expect(context.suggestion.lines.map((l: { accountCode: string; debitCents: number }) => [l.accountCode, l.debitCents])).toEqual([
        ['606100', 10000],
        ['445660', 2000],
      ])
    })
  })

  describe('rules engine', () => {
    it('applies a rule atomically and answers 409 the second time', async () => {
      const ruleId = await createRule()
      const apply = () => {
        state.user = { ...USERS.accountant }
        return applyRuleRoute.POST(
          new NextRequest(`http://localhost/api/transactions/${ids.aTx}/apply-rule`, {
            method: 'POST',
            body: JSON.stringify({ ruleId }),
            headers: { 'content-type': 'application/json' },
          }),
          { params: Promise.resolve({ id: ids.aTx }) },
        )
      }
      const [first, second] = await Promise.all([apply(), apply()])
      expect([first.status, second.status].sort()).toEqual([200, 409])
      expect(await entriesOf(ids.aTx)).toBe(1)
      const entry = await prisma.accountingEntry.findFirstOrThrow({ where: { sourceBankTransactionId: ids.aTx }, include: { lines: true } })
      const debit = entry.lines.reduce((s, l) => s + Number(l.debit) * 100, 0)
      const credit = entry.lines.reduce((s, l) => s + Number(l.credit) * 100, 0)
      expect(Math.round(debit)).toBe(12000)
      expect(Math.round(credit)).toBe(12000)
      // Generated lines are labelled in French
      expect(entry.lines.map((l) => l.description).sort()).toEqual(['CB PAPETERIE MARTIN', 'CB PAPETERIE MARTIN', 'TVA déductible 20 %'])
      // A draft: provisional number, the definitive one is given at validation
      expect(entry.status).toBe('draft')
      expect(entry.entryNumber).toMatch(/^BR-/)
    })

    it('never creates duplicate entries when "Exécuter le moteur" runs twice, even at once', async () => {
      await createRule()
      const run = () => processTransactions({ companyId: ids.aCompany, autoApply: true })
      const [a, b] = await Promise.all([run(), run()])
      expect(a.applied + b.applied).toBe(2) // aTx and aTx2, once each
      expect(a.errors).toEqual([])
      expect(b.errors).toEqual([])
      const third = await run()
      expect(third.processed).toBe(0)
      expect(await entriesOf(ids.aTx)).toBe(1)
      expect(await entriesOf(ids.aTx2)).toBe(1)

      // Explicit ids of reconciled transactions are skipped too
      const explicit = await processTransactions({ companyId: ids.aCompany, transactionIds: [ids.aTx], autoApply: true })
      expect(explicit.processed).toBe(0)
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany } })).toBe(2)
    })

    it('applies an enabled rule whatever its number of conditions, and only autoCreate rules when asked', async () => {
      // One condition: a former 80 % confidence threshold skipped it silently
      await createRule([{ conditionType: 'label', operator: 'contains', value: 'PAPETERIE' }])
      const automatic = await processTransactions({ companyId: ids.aCompany, autoApply: true, onlyAutoCreate: true })
      expect(automatic).toMatchObject({ matched: 2, applicable: 0, applied: 0 })

      const explicit = await processTransactions({ companyId: ids.aCompany, autoApply: true })
      expect(explicit).toMatchObject({ matched: 2, applicable: 2, applied: 2, errors: [] })
      const entry = await prisma.accountingEntry.findFirstOrThrow({ where: { sourceBankTransactionId: ids.aTx } })
      expect(entry.status).toBe('draft')
    })

    it('applies the highest priority rule when several match, and autoCreate rules on refresh runs', async () => {
      const low = await createRule([{ conditionType: 'label', operator: 'contains', value: 'PAPETERIE' }], { name: 'Basse', priority: 1 })
      await createRule(undefined, { name: 'Haute', priority: 5, autoCreate: true })
      const run = await processTransactions({ companyId: ids.aCompany, autoApply: true, onlyAutoCreate: true })
      expect(run).toMatchObject({ applied: 2 })
      const lowRule = await prisma.transactionRule.findUniqueOrThrow({ where: { id: low } })
      expect(lowRule.usageCount).toBe(0)
      expect((await prisma.transactionRule.findFirstOrThrow({ where: { name: 'Haute' } })).usageCount).toBe(2)
    })
  })
})

/** Rule "Fournitures Martin": 606100 with 20 % deductible VAT (445660), 3 conditions unless given. */
async function createRule(
  conditions: Array<{ conditionType: string; operator: string; value: string }> = [
    { conditionType: 'counterparty', operator: 'contains', value: 'Papeterie' },
    { conditionType: 'side', operator: 'equals', value: 'debit' },
    { conditionType: 'label', operator: 'contains', value: 'PAPETERIE' },
  ],
  options: { name?: string; priority?: number; autoCreate?: boolean } = {},
): Promise<string> {
  const rule = await prisma.transactionRule.create({
    data: {
      companyId: ids.aCompany,
      name: options.name ?? 'Fournitures Martin',
      priority: options.priority ?? 0,
      autoCreate: options.autoCreate ?? false,
      conditions: { create: conditions },
      entryLines: {
        create: [
          { accountCode: '606100', lineType: 'auto', amountType: 'full', order: 0, vatType: 'deductible', vatRate: 20, vatAccountCode: '445660' },
        ],
      },
    },
  })
  return rule.id
}
