/**
 * Draft-level MCP tools (kledg:write), the read tools added with them and
 * the prompts, against PostgreSQL, called through the real /api/mcp handler
 * with API keys of each level (Better Auth, services, triggers, row level
 * security and audit log real):
 * - the draft tools exist only with kledg:write, never for a read key;
 * - a company outside the key's grant, or of which the user is not a
 *   member, is "Société introuvable"; an object of another company is not
 *   found through a granted one;
 * - a role without the right of the route (viewer) is refused, and reads
 *   still work for it;
 * - invalid arguments answer in French;
 * - budgets: budget, line and its months written in cents, answered in
 *   euros; year-end: provision, assessment and the prepared entries as
 *   DRAFTS, idempotent; approval data merged and saved;
 * - every write is audited (MCP_WRITE);
 * - prompts are listed and return their workflow.
 *
 * Run with KLEDG_RLS=enforce too (docs/rls.md). Skipped when the test
 * database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('mcp_draft_tools')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { AccessLevel, CompanyAccess } from '@/lib/ai-access/access'

const available = await testDatabaseAvailable()

type Handler = (request: Request) => Promise<Response>

let prisma: typeof import('@/lib/prisma').prisma
let mcp: Record<'POST', Handler>
let createApiKeyWithGrant: typeof import('@/lib/ai-access/create-api-key.service').createApiKeyWithGrant

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }
const VIEWER = { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' }

const DRAFT_TOOLS = [
  'create_budget',
  'create_budget_line',
  'update_budget_line',
  'classify_subscription',
  'add_subscription_to_budget',
  'create_provision',
  'record_provision_assessment',
  'create_investment_grant',
  'prepare_year_end_entries',
  'create_draft_expense_report',
  'update_year_end_formalities',
  'accept_expense_suggestion',
]

const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seedCompany(prefix: 'a' | 'b' | 'c', siren: string, members: Array<[string, string]>) {
  const company = await prisma.company.create({
    data: { name: `Société ${prefix.toUpperCase()}`, slug: `societe-${prefix}`, siren, legalType: 'SAS', closingDay: 31, closingMonth: 12 },
  })
  await prisma.organization.create({ data: { id: `org-${prefix}`, name: company.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id } })
  for (const [userId, role] of members) {
    await prisma.member.create({ data: { id: `m-${prefix}-${userId}`, userId, organizationId: `org-${prefix}`, role, createdAt: new Date() } })
  }
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31'), closingDay: 31, closingMonth: 12 },
  })
  for (const [code, label] of [
    ['606', 'Achats non stockés'],
    ['706', 'Prestations de services'],
  ]) {
    await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label, isPCG: true } })
  }
  ids[`${prefix}Company`] = company.id
  ids[`${prefix}Fy`] = fy.id
}

async function seed() {
  await prepareTestDatabase('mcp_draft_tools')
  for (const user of [OWNER, VIEWER]) await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  await seedCompany('a', '123456782', [
    [OWNER.id, 'companyAdmin'],
    [VIEWER.id, 'viewer'],
  ])
  await seedCompany('b', '222222222', [[OWNER.id, 'companyAdmin']])
  await seedCompany('c', '333333333', [])
}

async function apiKey(level: AccessLevel, access: CompanyAccess = { allCompanies: true, companyIds: [] }, user: typeof OWNER = OWNER): Promise<string> {
  return (await createApiKeyWithGrant({ ...user }, `Clé ${level}`, access, level, 'validation')).key
}

async function rpc(key: string, method: string, params: unknown = {}) {
  const response = await mcp.POST(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  expect(response.status).toBe(200)
  const text = await response.text()
  const raw = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? 'null')
  return JSON.parse(raw) as {
    result?: {
      tools?: Array<{ name: string; annotations?: Record<string, boolean> }>
      prompts?: Array<{ name: string; title?: string; arguments?: Array<{ name: string; required?: boolean }> }>
      messages?: Array<{ role: string; content: { text: string } }>
      content?: Array<{ text: string }>
      isError?: boolean
    }
    error?: { message: string }
  }
}

async function toolNames(key: string): Promise<string[]> {
  return ((await rpc(key, 'tools/list')).result?.tools ?? []).map((t) => t.name)
}

interface CallResult {
  ok: boolean
  text: string
  data: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function call(key: string, name: string, args: Record<string, unknown>): Promise<CallResult> {
  const body = await rpc(key, 'tools/call', { name, arguments: args })
  const text = body.result?.content?.[0]?.text ?? body.error?.message ?? ''
  const ok = !body.result?.isError && !body.error
  return { ok, text, data: ok ? JSON.parse(text) : {} }
}

describe.skipIf(!available)('draft-level MCP tools', () => {
  beforeAll(async () => {
    await prepareTestDatabase('mcp_draft_tools')
    ;({ prisma } = await import('@/lib/prisma'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as Record<'POST', Handler>
    ;({ createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service'))
  }, 60_000)

  beforeEach(seed)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('access level', () => {
    it('lists the draft tools only for a key of level write or more, annotated as writes', async () => {
      const read = await toolNames(await apiKey('read'))
      for (const tool of DRAFT_TOOLS) expect(read, tool).not.toContain(tool)
      expect(read).toEqual(expect.arrayContaining(['list_budgets', 'get_budget', 'list_tax_deadlines', 'get_bank_sync_status', 'get_auxiliary_balance', 'list_doubtful_receivables', 'list_expense_claimants']))

      const listed = (await rpc(await apiKey('write'), 'tools/list')).result?.tools ?? []
      for (const tool of DRAFT_TOOLS) {
        const found = listed.find((t) => t.name === tool)
        expect(found, tool).toBeDefined()
        expect(found?.annotations, tool).toMatchObject({ readOnlyHint: false, openWorldHint: false })
      }
      expect(listed.map((t) => t.name)).not.toContain('validate_entries')
    })

    it('refuses a draft tool called with a read key, and writes nothing', async () => {
      const refused = await call(await apiKey('read'), 'create_budget', { companyId: ids.aCompany, fiscalYearId: ids.aFy })
      expect(refused.ok).toBe(false)
      expect(await prisma.budget.count()).toBe(0)
    })
  })

  describe('company grant and roles', () => {
    it('answers "Société introuvable" outside the grant or without membership, and never finds an object of another company', async () => {
      const onlyA = await apiKey('write', { allCompanies: false, companyIds: [ids.aCompany] })
      for (const companyId of [ids.bCompany, ids.cCompany]) {
        for (const [tool, args] of [
          ['create_budget', { fiscalYearId: ids.bFy }],
          ['prepare_year_end_entries', { fiscalYearId: ids.bFy }],
          ['update_year_end_formalities', { fiscalYearId: ids.bFy, rcsCity: 'Lyon' }],
          ['get_budget', {}],
        ] as const) {
          const result = await call(onlyA, tool, { companyId, ...args })
          expect(result.ok, `${tool} ${companyId}`).toBe(false)
          expect(result.text).toBe('Société introuvable')
        }
      }

      const full = await apiKey('write')
      const budgetOfB = await call(full, 'create_budget', { companyId: ids.bCompany, fiscalYearId: ids.bFy })
      const lineOfB = await call(full, 'create_budget_line', { companyId: ids.bCompany, fiscalYearId: ids.bFy, accountPrefix: '606' })
      expect(budgetOfB.ok && lineOfB.ok, lineOfB.text).toBe(true)
      const crossed = await call(full, 'update_budget_line', { companyId: ids.aCompany, lineId: lineOfB.data.line.id, label: 'Piratée' })
      expect(crossed.ok).toBe(false)
      expect(crossed.text).toBe('Ligne de budget introuvable')
      const yearOfB = await call(full, 'create_budget', { companyId: ids.aCompany, fiscalYearId: ids.bFy })
      expect(yearOfB.text).toBe('Exercice introuvable')
      expect((await prisma.budgetLine.findUniqueOrThrow({ where: { id: lineOfB.data.line.id } })).label).not.toBe('Piratée')
    })

    it('refuses a viewer the writes of the routes while its reads keep working', async () => {
      const viewer = await apiKey('write', { allCompanies: true, companyIds: [] }, VIEWER)
      for (const [tool, args] of [
        ['create_budget', { fiscalYearId: ids.aFy }],
        ['create_provision', { category: 'RISK_CHARGE', label: 'Litige', justification: 'Avocat', accountCode: '151', openedOn: '2025-03-01' }],
        ['prepare_year_end_entries', { fiscalYearId: ids.aFy }],
        ['update_year_end_formalities', { fiscalYearId: ids.aFy, rcsCity: 'Lyon' }],
      ] as const) {
        const result = await call(viewer, tool, { companyId: ids.aCompany, ...args })
        expect(result.ok, tool).toBe(false)
        expect(result.text, tool).not.toBe('Société introuvable')
      }
      expect(await prisma.budget.count()).toBe(0)
      expect(await prisma.provision.count()).toBe(0)
      expect((await call(viewer, 'list_budgets', { companyId: ids.aCompany })).ok).toBe(true)
      expect((await call(viewer, 'list_tax_deadlines', { companyId: ids.aCompany })).ok).toBe(true)
    })
  })

  describe('budgets', () => {
    it('creates a budget and a line in cents, answers euros, replaces the months on update and audits each write', async () => {
      const key = await apiKey('write')
      const created = await call(key, 'create_budget', { companyId: ids.aCompany, fiscalYearId: ids.aFy })
      expect(created.ok, created.text).toBe(true)
      expect(created.data.reviewUrl).toBe(`http://localhost:3000/${ids.aCompany}/budget`)

      const line = await call(key, 'create_budget_line', {
        companyId: ids.aCompany,
        fiscalYearId: ids.aFy,
        accountPrefix: '606',
        amounts: [
          { month: '2025-01', amount: 1200.5 },
          { month: '2025-02', amount: 300 },
        ],
      })
      expect(line.ok, line.text).toBe(true)
      expect(line.data.line).toMatchObject({ accountPrefix: '606', label: 'Achats non stockés', annualBudget: 1500.5 })
      const amounts = await prisma.budgetLineAmount.findMany({ where: { lineId: line.data.line.id }, orderBy: { month: 'asc' } })
      expect(amounts.map((a) => [a.month, a.amount.toString()])).toEqual([
        ['2025-01', '1200.5'],
        ['2025-02', '300'],
      ])

      const updated = await call(key, 'update_budget_line', { companyId: ids.aCompany, lineId: line.data.line.id, amounts: [{ month: '2025-03', amount: 99.99 }] })
      expect(updated.ok, updated.text).toBe(true)
      expect(updated.data.line.amounts).toEqual([{ month: '2025-03', amount: 99.99 }])

      const read = await call(key, 'get_budget', { companyId: ids.aCompany, fiscalYearId: ids.aFy })
      expect(read.data.lines).toEqual([expect.objectContaining({ id: line.data.line.id, annualBudget: 99.99 })])

      const again = await call(key, 'create_budget', { companyId: ids.aCompany, fiscalYearId: ids.aFy })
      expect(again.ok).toBe(false)
      expect(again.text).toBe("L'exercice 2025 a déjà un budget.")

      const audit = await prisma.auditLog.findMany({ where: { action: 'MCP_WRITE' } })
      expect(audit.map((r) => (r.metadata as { tool: string }).tool).sort()).toEqual(['create_budget', 'create_budget_line', 'update_budget_line'])
    })

    it('answers invalid arguments in French and writes nothing', async () => {
      const key = await apiKey('write')
      await call(key, 'create_budget', { companyId: ids.aCompany, fiscalYearId: ids.aFy })
      const third = await call(key, 'create_budget_line', { companyId: ids.aCompany, fiscalYearId: ids.aFy, accountPrefix: '606', amounts: [{ month: '2025-01', amount: 10.005 }] })
      expect(third.text).toBe('Montant de 2025-01 : montant invalide, en euros avec deux décimales au plus.')
      const outside = await call(key, 'create_budget_line', { companyId: ids.aCompany, fiscalYearId: ids.aFy, accountPrefix: '606', amounts: [{ month: '2026-01', amount: 10 }] })
      expect(outside.text).toBe("Le mois 2026-01 n'est pas dans l'exercice 2025.")
      expect(await prisma.budgetLine.count()).toBe(0)
    })
  })

  describe('year-end work', () => {
    it('records a provision and its assessment, then prepares its dotation as a DRAFT, once', async () => {
      const key = await apiKey('write')
      const provision = await call(key, 'create_provision', {
        companyId: ids.aCompany,
        category: 'RISK_CHARGE',
        label: 'Litige Martin',
        justification: "Assignation, estimation de l'avocat",
        accountCode: '1511',
        openedOn: '2025-03-01',
      })
      expect(provision.ok, provision.text).toBe(true)
      const assessed = await call(key, 'record_provision_assessment', { companyId: ids.aCompany, provisionId: provision.data.provisionId, fiscalYearId: ids.aFy, requiredBalance: 8000 })
      expect(assessed.ok, assessed.text).toBe(true)

      const prepared = await call(key, 'prepare_year_end_entries', { companyId: ids.aCompany, fiscalYearId: ids.aFy })
      expect(prepared.ok, prepared.text).toBe(true)
      expect(prepared.data.changes.draftsCreated).toEqual([expect.objectContaining({ kind: 'provision', amount: 8000, movement: 'dotation' })])
      const entry = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: prepared.data.changes.draftsCreated[0].entryId }, include: { lines: { include: { account: true } } } })
      expect(entry.status).toBe('draft')
      expect(entry.lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString()]).sort()).toEqual([
        ['1511', '0', '8000'],
        ['6815', '8000', '0'],
      ])

      const again = await call(key, 'prepare_year_end_entries', { companyId: ids.aCompany, fiscalYearId: ids.aFy })
      expect(again.data.changes.draftsCreated).toEqual([])
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany } })).toBe(1)
      expect(await prisma.accountingEntry.count({ where: { status: 'validated' } })).toBe(0)

      const inventory = await call(key, 'get_year_end_inventory', { companyId: ids.aCompany, fiscalYearId: ids.aFy })
      expect(inventory.data.provisions[0]).toMatchObject({ requiredBalance: 8000, status: 'draft' })
    })

    it('records an investment grant', async () => {
      const key = await apiKey('write')
      const grant = await call(key, 'create_investment_grant', { companyId: ids.aCompany, label: 'Région', amount: 12000, grantedOn: '2025-03-01', spreading: 'LINEAR', durationYears: 5 })
      expect(grant.ok, grant.text).toBe(true)
      expect((await prisma.investmentGrant.findUniqueOrThrow({ where: { id: grant.data.grantId } })).amount.toString()).toBe('12000')
    })
  })

  describe('approval of the accounts', () => {
    it('merges the fields given into the saved data and answers what is still missing', async () => {
      const key = await apiKey('write')
      const first = await call(key, 'update_year_end_formalities', { companyId: ids.aCompany, fiscalYearId: ids.aFy, rcsCity: 'Lyon', size: { category: 'micro' } })
      expect(first.ok, first.text).toBe(true)
      const second = await call(key, 'update_year_end_formalities', { companyId: ids.aCompany, fiscalYearId: ids.aFy, approvedOn: '2026-05-20', meeting: { date: '2026-05-20' } })
      expect(second.ok, second.text).toBe(true)
      expect(second.data.changes.fields).toEqual(['approvedOn', 'meeting.date'])
      expect(Array.isArray(second.data.missing)).toBe(true)
      const row = await prisma.accountsApproval.findFirstOrThrow({ where: { companyId: ids.aCompany } })
      expect(row.details).toMatchObject({ rcsCity: 'Lyon', size: { category: 'micro' }, approvedOn: '2026-05-20' })
      expect(row.approvedOn?.toISOString().slice(0, 10)).toBe('2026-05-20')

      const early = await call(key, 'update_year_end_formalities', { companyId: ids.aCompany, fiscalYearId: ids.aFy, filedOn: '2025-06-01' })
      expect(early.ok).toBe(false)
      expect(early.text).toBe("La date de dépôt doit être postérieure à la clôture de l'exercice (31/12/2025).")
    })
  })

  describe('simple mode', () => {
    async function seedExpense() {
      const fiscalYearId = ids.aFy
      for (const [code, label] of [['5121', 'Comptes en euros'], ['626', 'Frais postaux et de télécommunications'], ['44566', 'TVA sur autres biens et services']]) {
        await prisma.account.create({ data: { companyId: ids.aCompany, fiscalYearId, code, label, isPCG: true } })
      }
      await prisma.journal.create({ data: { companyId: ids.aCompany, code: 'BQ', label: 'Banque' } })
      const connection = await prisma.bankConnection.create({ data: { companyId: ids.aCompany, provider: 'MANUAL' } })
      const account = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'acc-simple', name: 'Compte courant' } })
      return prisma.bankTransaction.create({
        data: { bankAccountId: account.id, externalTransactionId: 'simple-1', amount: 47.99, date: day('2025-03-10'), side: 'debit', label: 'PRLV SEPA FREE PRO' },
      })
    }

    it('lists the expenses to review with a read key and confirms one as a draft with a write key, in euros, audited', async () => {
      const transaction = await seedExpense()
      const read = await call(await apiKey('read'), 'list_expenses_to_review', { companyId: ids.aCompany })
      expect(read.ok, read.text).toBe(true)
      expect(read.data.expenses).toEqual([
        expect.objectContaining({ transactionId: transaction.id, amount: 47.99, payee: 'Free Pro', suggestion: expect.objectContaining({ categoryId: 'telephone-internet', category: 'Téléphone et internet', confidence: 'high' }) }),
      ])
      expect((await call(await apiKey('read'), 'accept_expense_suggestion', { companyId: ids.aCompany, transactionId: transaction.id })).ok).toBe(false)

      const key = await apiKey('write')
      const confirmed = await call(key, 'accept_expense_suggestion', { companyId: ids.aCompany, transactionId: transaction.id })
      expect(confirmed.ok, confirmed.text).toBe(true)
      expect(confirmed.data).toMatchObject({ status: 'draft', categoryId: 'telephone-internet', reviewUrl: `http://localhost:3000/${ids.aCompany}/entries/simple-mode` })
      expect(confirmed.data.lines).toEqual(
        expect.arrayContaining([
          { accountCode: '5121', debit: 0, credit: 47.99 },
          { accountCode: '626', debit: 39.99, credit: 0 },
          { accountCode: '44566', debit: 8, credit: 0 },
        ]),
      )
      const entry = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: confirmed.data.entryId }, include: { simpleModeEntry: true } })
      expect(entry).toMatchObject({ status: 'draft', sourceBankTransactionId: transaction.id })
      expect(entry.simpleModeEntry).toMatchObject({ source: 'mcp', createdById: OWNER.id })
      const audit = await prisma.auditLog.findFirst({ where: { action: 'MCP_WRITE', companyId: ids.aCompany } })
      expect(audit?.metadata).toMatchObject({ tool: 'accept_expense_suggestion', transactionId: transaction.id, entryId: entry.id })

      const again = await call(key, 'accept_expense_suggestion', { companyId: ids.aCompany, transactionId: transaction.id })
      expect(again.ok).toBe(false)
      expect(again.text).toMatch(/déjà rapprochée/)
    })

    it('lists money in with the sales invoice it pays and confirms its payment as a draft, recorded once validated', async () => {
      await seedExpense()
      const fiscalYearId = ids.aFy
      for (const [code, label] of [['411', 'Clients'], ['707', 'Ventes de marchandises'], ['44571', 'TVA collectée']]) {
        await prisma.account.create({ data: { companyId: ids.aCompany, fiscalYearId, code, label, isPCG: true } })
      }
      await prisma.journal.create({ data: { companyId: ids.aCompany, code: 'VE', label: 'Ventes' } })
      const { createTiers } = await import('@/lib/tiers/manage-tiers.service')
      const { createInvoice } = await import('@/lib/invoices/manage-invoices.service')
      const { postInvoice } = await import('@/lib/invoices/post-invoice.service')
      const customer = await createTiers(ids.aCompany, { kind: 'CUSTOMER', name: 'Studio Nord', email: null })
      const invoice = await createInvoice(ids.aCompany, {
        direction: 'SALE',
        tiersId: customer.id,
        number: 'F-2025-031',
        numbering: 'recorded',
        issueDate: '2025-03-01',
        typeCode: '380',
        lines: [{ label: 'Lampes', quantity: '1', unitPriceCents: 100_000, vatRateBp: 2000, accountCode: null, nature: 'GOODS', fixedAsset: false }],
      })
      await postInvoice(ids.aCompany, invoice.id)
      const bankAccount = await prisma.bankAccount.findFirstOrThrow({ where: { externalAccountId: 'acc-simple' } })
      const received = await prisma.bankTransaction.create({
        data: { bankAccountId: bankAccount.id, externalTransactionId: 'simple-in-1', amount: 1200, date: day('2025-03-20'), side: 'credit', label: 'VIR SEPA STUDIO NORD F-2025-031' },
      })

      const read = await call(await apiKey('read'), 'list_expenses_to_review', { companyId: ids.aCompany, side: 'credit' })
      expect(read.ok, read.text).toBe(true)
      expect(read.data.expenses).toEqual([
        expect.objectContaining({
          transactionId: received.id,
          side: 'credit',
          amount: 1200,
          suggestion: expect.objectContaining({ source: 'invoice', confidence: 'high', categoryId: null, invoice: { invoiceId: invoice.id, number: 'F-2025-031', customer: 'Studio Nord', remaining: 1200, partial: false } }),
        }),
      ])

      const confirmed = await call(await apiKey('write'), 'accept_expense_suggestion', { companyId: ids.aCompany, transactionId: received.id, invoiceId: invoice.id })
      expect(confirmed.ok, confirmed.text).toBe(true)
      expect(confirmed.data).toMatchObject({ status: 'draft', categoryId: null, invoice: { invoiceId: invoice.id, number: 'F-2025-031', customer: 'Studio Nord', recorded: false } })
      expect(confirmed.data.lines).toEqual(
        expect.arrayContaining([
          { accountCode: '5121', debit: 1200, credit: 0 },
          { accountCode: '411', debit: 0, credit: 1200 },
        ]),
      )
      expect(await prisma.invoicePayment.count({ where: { invoiceId: invoice.id } })).toBe(0)
      const audit = await prisma.auditLog.findFirst({ where: { action: 'MCP_WRITE', companyId: ids.aCompany }, orderBy: { createdAt: 'desc' } })
      expect(audit?.metadata).toMatchObject({ tool: 'accept_expense_suggestion', transactionId: received.id, invoiceId: invoice.id })
    })

    it('refuses a viewer and a company outside the grant', async () => {
      const transaction = await seedExpense()
      const viewer = await apiKey('write', { allCompanies: true, companyIds: [] }, VIEWER)
      const refused = await call(viewer, 'accept_expense_suggestion', { companyId: ids.aCompany, transactionId: transaction.id })
      expect(refused.ok).toBe(false)
      expect(refused.text).not.toBe('Société introuvable')
      const onlyB = await apiKey('write', { allCompanies: false, companyIds: [ids.bCompany] })
      const outside = await call(onlyB, 'accept_expense_suggestion', { companyId: ids.aCompany, transactionId: transaction.id })
      expect(outside.text).toBe('Société introuvable')
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany } })).toBe(0)
    })
  })

  describe('read tools and prompts', () => {
    it('answers the bank state and the deadlines of a company', async () => {
      const key = await apiKey('read')
      const bank = await call(key, 'get_bank_sync_status', { companyId: ids.aCompany })
      expect(bank.data).toEqual({ syncPaused: null, connections: [], integrations: [] })
      const deadlines = await call(key, 'list_tax_deadlines', { companyId: ids.aCompany, fiscalYearId: ids.aFy })
      expect(deadlines.ok, deadlines.text).toBe(true)
      expect(deadlines.data.fiscalYear).toMatchObject({ id: ids.aFy, year: 2025 })
    })

    it('lists the prompts and returns a workflow naming the tools of the connection', async () => {
      const key = await apiKey('read')
      const listed = (await rpc(key, 'prompts/list')).result?.prompts ?? []
      expect(listed.map((p) => p.name)).toEqual(['cloture_du_mois', 'preparer_cloture_exercice', 'revue_budgetaire', 'sante_financiere', 'approbation_des_comptes'])
      expect(listed[0].arguments).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'companyId', required: true })]))
      const prompt = await rpc(key, 'prompts/get', { name: 'preparer_cloture_exercice', arguments: { companyId: ids.aCompany } })
      const text = prompt.result?.messages?.[0]?.content.text ?? ''
      expect(text).toContain('`get_year_end_inventory`')
      expect(text).not.toContain('prepare_year_end_entries')
    })
  })
})
