/**
 * Approvals and rights of assistant tools, through the real /api/mcp handler
 * with API keys on PostgreSQL (session mocked; services, triggers and audit
 * log real):
 * - the dry run of a bulk action says what it will do: run_rules lists each
 *   rule with its accounts, its number of transactions and the assistant
 *   that created or changed it; bulk_reconcile auto_match lists the
 *   transaction and entry pairs it would link; the approval still executes;
 * - mark_declaration and record_tax_filing settle a deadline: on a
 *   draft-level key they return a dry run and wait for the approval in Kledg;
 * - file_receipt match records the fields read: refused on an archived
 *   company, like its route;
 * - get_statement_layout reads the income statement layout without storing
 *   the default; a line of that default can still be changed;
 * - copy_rules_from_company checks the source company before reading it.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('sec_mcp_approvals')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { AccessLevel, CompanyAccess, ExecutionMode } from '@/lib/ai-access/access'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let mcp: { POST: (request: Request) => Promise<Response> }

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ids = {} as Record<string, string>
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])

async function call(key: string, name: string, args: Record<string, unknown>) {
  const response = await mcp.POST(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }),
  )
  const text = await response.text()
  const raw = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? 'null')
  const body = JSON.parse(raw) as { result?: { content?: Array<{ text: string }>; isError?: boolean }; error?: { message: string } }
  const out = body.result?.content?.[0]?.text ?? body.error?.message ?? ''
  const ok = !body.result?.isError && !body.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok, text: out, data: (ok ? JSON.parse(out) : {}) as Record<string, any> }
}

async function ok(key: string, name: string, args: Record<string, unknown>) {
  const result = await call(key, name, args)
  expect(result.ok, `${name}: ${result.text}`).toBe(true)
  return result.data
}

async function apiKey(level: AccessLevel, mode: ExecutionMode = 'validation', access: CompanyAccess = { allCompanies: true, companyIds: [] }, name = `Assistant ${level}`) {
  const { createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service')
  return (await createApiKeyWithGrant({ ...OWNER }, name, access, level, mode)).key
}

async function approve(actionId: string) {
  const { decideAction } = await import('@/lib/mcp/full-control/pending-actions')
  await decideAction(OWNER.id, actionId, 'approve')
}

async function seedCompany(prefix: string, siren: string) {
  const company = await prisma.company.create({ data: { name: `Société ${prefix}`, slug: `societe-${prefix}`, siren, legalType: 'SAS', closingDay: 31, closingMonth: 12, vatRegime: 'normal', corporateTaxRegime: 'simplified' } })
  await prisma.organization.create({ data: { id: `org-${prefix}`, name: company.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id } })
  await prisma.member.create({ data: { id: `m-${prefix}`, userId: OWNER.id, organizationId: `org-${prefix}`, role: 'companyAdmin', createdAt: new Date() } })
  const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31'), closingDay: 31, closingMonth: 12 } })
  for (const [code, label] of [['401', 'Fournisseurs'], ['512000', 'Banque'], ['606', 'Achats'], ['627', 'Services bancaires']]) {
    ids[`${prefix}:${code}`] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label, isPCG: true } })).id
  }
  ids[`${prefix}:BQ`] = (await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })).id
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL', login: `l-${prefix}` } })
  ids[`${prefix}:bank`] = (await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `acc-${prefix}`, name: 'Compte courant', ledgerAccountCode: '512000' } })).id
  ids[prefix] = company.id
  ids[`${prefix}:fy`] = fy.id
}

let transactions = 0
async function transaction(prefix: string, label: string, amount: string, date = '2025-03-10') {
  transactions += 1
  return prisma.bankTransaction.create({
    data: { bankAccountId: ids[`${prefix}:bank`], externalTransactionId: `tx-${transactions}`, amount, date: day(date), side: 'debit', label },
  })
}

describe.skipIf(!available)('approvals and rights of assistant tools', () => {
  beforeAll(async () => {
    await prepareTestDatabase('sec_mcp_approvals')
    ;({ prisma } = await import('@/lib/prisma'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as typeof mcp
    await prisma.user.create({ data: OWNER })
    await seedCompany('a', '123456782')
    await seedCompany('b', '222222222')
    state.user = OWNER
  }, 180_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('the dry run of a bulk action lists what it will do', () => {
    it('run_rules: each rule, its accounts, its transactions and the assistant that created it', async () => {
      const key = await apiKey('admin', 'validation', { allCompanies: true, companyIds: [] }, 'Assistant pressé')
      // Created at once by the assistant (autoCreate false is not high impact)
      const created = await ok(key, 'create_rule', {
        companyId: ids.a,
        name: 'Frais bancaires',
        conditions: [{ conditionType: 'label', operator: 'contains', value: 'FRAIS' }],
        entryLines: [{ accountCode: '627', lineType: 'auto', amountType: 'full' }],
      })
      // A rule written in Kledg, not by an assistant
      const { createRule } = await import('@/lib/transactions/manage-rules.service')
      const own = await createRule(ids.a, {
        name: 'Achats',
        enabled: true,
        priority: 0,
        journalCode: 'BQ',
        autoCreate: false,
        conditions: [{ conditionType: 'label', operator: 'contains', value: 'ACHAT' }],
        entryLines: [{ accountCode: '606', lineType: 'auto', amountType: 'full' }],
      } as Parameters<typeof createRule>[1])
      const t1 = await transaction('a', 'FRAIS TENUE COMPTE', '12.00')
      const t2 = await transaction('a', 'FRAIS CARTE', '3.50')
      const t3 = await transaction('a', 'ACHAT PAPIER', '20.00')

      const dry = await ok(key, 'run_rules', { companyId: ids.a, transactionIds: [t1.id, t2.id, t3.id] })
      expect(dry.dryRun).toBe(true)
      expect(dry.preview).toMatchObject({ wouldApply: 3, rulesTotal: 2, rulesChangedByAssistant: 1 })
      expect(dry.preview.rules).toEqual([
        {
          ruleId: created.result.id,
          name: 'Frais bancaires',
          journalCode: 'BQ',
          autoCreate: false,
          accounts: ['627'],
          transactions: 2,
          byAssistant: { change: 'created', tool: 'create_rule', assistant: 'Assistant pressé', at: expect.any(String) },
        },
        { ruleId: own.id, name: 'Achats', journalCode: 'BQ', autoCreate: false, accounts: ['606'], transactions: 1, byAssistant: null },
      ])
      // The approval page reads the stored preview
      const pending = await prisma.mcpPendingAction.findUniqueOrThrow({ where: { id: dry.actionId } })
      expect(JSON.stringify(pending.preview)).toContain('Assistant pressé')

      // The richer dry run is still bound to the approval: unchanged data executes
      await approve(dry.actionId)
      const done = await ok(key, 'run_rules', { companyId: ids.a, transactionIds: [t1.id, t2.id, t3.id], actionId: dry.actionId })
      expect(done.result.applied).toBe(3)
    })

    it('bulk_reconcile auto_match: the transaction and entry pairs, nothing linked before the approval', async () => {
      const key = await apiKey('admin')
      const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
      const entry = await createEntry({
        companyId: ids.a,
        journalId: ids['a:BQ'],
        date: '2025-04-02',
        description: 'Fournisseur Martin',
        lines: [
          { accountId: ids['a:401'], debit: '250.00', credit: 0 },
          { accountId: ids['a:512000'], debit: 0, credit: '250.00' },
        ],
      })
      const tx = await transaction('a', 'VIR MARTIN', '250.00', '2025-04-02')

      const dry = await ok(key, 'bulk_reconcile', { companyId: ids.a, action: 'auto_match' })
      expect(dry.preview).toMatchObject({ action: 'auto_match', pairsTotal: 1, releasedTransactions: 0 })
      expect(dry.preview.pairs).toEqual([
        {
          transaction: { id: tx.id, date: '2025-04-02', label: 'VIR MARTIN', amount: 250, side: 'debit' },
          entry: expect.objectContaining({ id: entry.id, description: 'Fournisseur Martin', date: '2025-04-02' }),
        },
      ])
      expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } })).reconciled).toBe(false)

      await approve(dry.actionId)
      await ok(key, 'bulk_reconcile', { companyId: ids.a, action: 'auto_match', actionId: dry.actionId })
      expect(await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } })).toMatchObject({ reconciled: true, reconciledWith: entry.id })
    })
  })

  describe('records that settle a deadline wait for the approval in Kledg', () => {
    it('mark_declaration on a draft-level key: dry run, nothing recorded until approved', async () => {
      const key = await apiKey('write', 'automatic')
      const list = await ok(key, 'list_declarations_status', { companyId: ids.a })
      const deadline = (list.deadlines as Array<{ deadlineId: string; lockedFields: string[] }>).find((d) => d.lockedFields.length === 0)
      expect(deadline, 'a deadline of the company').toBeTruthy()
      const args = { companyId: ids.a, deadlineId: deadline!.deadlineId, note: 'Déposée par le cabinet' }

      const dry = await ok(key, 'mark_declaration', args)
      expect(dry).toMatchObject({ dryRun: true, actionId: expect.any(String), preview: { deadline: { deadlineId: deadline!.deadlineId } } })
      expect(await prisma.declarationStatus.count({ where: { companyId: ids.a } })).toBe(0)

      await approve(dry.actionId)
      const done = await ok(key, 'mark_declaration', { ...args, actionId: dry.actionId })
      expect(done.executed).toBe(true)
      expect(await prisma.declarationStatus.count({ where: { companyId: ids.a } })).toBe(1)
    })

    it('record_tax_filing on a draft-level key: dry run, nothing recorded', async () => {
      const key = await apiKey('write', 'automatic')
      const before = await prisma.corporateTaxReturn.count({ where: { companyId: ids.a, filedOn: { not: null } } })
      const dry = await ok(key, 'record_tax_filing', {
        companyId: ids.a,
        tax: 'corporate_tax',
        corporateTax: { fiscalYearId: ids['a:fy'], filedOn: '2026-05-15', resultBeforeDeficits: 5000, deficitsImputed: 0, corporateTax: 750, reducedRate: true },
      })
      expect(dry).toMatchObject({ dryRun: true, actionId: expect.any(String), preview: { tax: 'corporate_tax', action: 'record', current: null } })
      expect(await prisma.corporateTaxReturn.count({ where: { companyId: ids.a, filedOn: { not: null } } })).toBe(before)
    })
  })

  it('file_receipt match records nothing on an archived company', async () => {
    const key = await apiKey('write')
    const staged = await ok(key, 'stage_receipt', { companyId: ids.b, contentBase64: Buffer.concat([JPEG, Buffer.from('archived')]).toString('base64'), fileName: 'ticket.jpg' })
    await prisma.company.update({ where: { id: ids.b }, data: { archivedAt: new Date() } })
    try {
      const matched = await call(key, 'file_receipt', { companyId: ids.b, action: 'match', stagedReceiptId: staged.stagedReceiptId, amount: 9.9, date: '2026-10-01', merchant: 'Café' })
      expect(matched.ok).toBe(false)
      expect(matched.text).toMatch(/archivée/)
      const row = await prisma.stagedReceipt.findUniqueOrThrow({ where: { id: staged.stagedReceiptId } })
      expect(row.amount).toBeNull()
    } finally {
      await prisma.company.update({ where: { id: ids.b }, data: { archivedAt: null } })
    }
  })

  it('get_statement_layout reads the income statement layout without storing it; its lines stay editable', async () => {
    const reader = await apiKey('read')
    const layout = await ok(reader, 'get_statement_layout', { companyId: ids.b, statement: 'income_statement', variant: 'simplified' })
    expect(layout.lines.length).toBeGreaterThan(0)
    expect(layout.isDefault).toBe(true)
    expect(await prisma.incomeStatementLineConfig.count({ where: { companyId: ids.b } })).toBe(0)
    // The same ids on a second read
    const again = await ok(reader, 'get_statement_layout', { companyId: ids.b, statement: 'income_statement', variant: 'simplified' })
    expect(again.lines.map((l: { id: string }) => l.id)).toEqual(layout.lines.map((l: { id: string }) => l.id))

    // A change of a line of the default stores the layout first, under the same ids
    const { updateIncomeStatementLine } = await import('@/lib/reports/config/manage-layouts.service')
    const first = layout.lines[0] as { id: string; lineLabel: string }
    await updateIncomeStatementLine(ids.b, first.id, { notes: 'Note du cabinet' })
    const stored = await prisma.incomeStatementLineConfig.findFirstOrThrow({ where: { id: first.id, companyId: ids.b } })
    expect(stored).toMatchObject({ lineLabel: first.lineLabel, notes: 'Note du cabinet' })
    const after = await ok(reader, 'get_statement_layout', { companyId: ids.b, statement: 'income_statement', variant: 'simplified' })
    expect(after.isDefault).toBeUndefined()
  })

  it('copy_rules_from_company refuses a source outside the connection before reading its rules', async () => {
    const { createRule } = await import('@/lib/transactions/manage-rules.service')
    const sourceRule = await createRule(ids.b, {
      name: 'Loyer',
      enabled: true,
      priority: 0,
      journalCode: 'BQ',
      autoCreate: true,
      conditions: [{ conditionType: 'label', operator: 'contains', value: 'LOYER' }],
      entryLines: [{ accountCode: '606', lineType: 'auto', amountType: 'full' }],
    } as Parameters<typeof createRule>[1])
    const onlyA = await apiKey('admin', 'validation', { allCompanies: false, companyIds: [ids.a] })
    const pendingBefore = await prisma.mcpPendingAction.count()

    const copy = await call(onlyA, 'copy_rules_from_company', { companyId: ids.a, sourceCompanyId: ids.b, ruleIds: [sourceRule.id], enabled: true })
    expect(copy.ok).toBe(false)
    expect(copy.text).toBe('Société introuvable')
    expect(await prisma.mcpPendingAction.count()).toBe(pendingBefore)
  })
})
