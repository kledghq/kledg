/**
 * The MCP tools that cover the rest of the API (lib/mcp/route-coverage.ts),
 * against PostgreSQL, called through the real /api/mcp handler with API
 * keys of each level (session mocked; Better Auth, services, triggers, row
 * level security and audit log real):
 * - each tool exists at its level and above, never below;
 * - a company outside the key's grant, or of which the user is not a
 *   member, is "Société introuvable" for every tool;
 * - a role without the right of the route (viewer) is refused by every
 *   tool that writes, per action for the tools that group several routes;
 * - high-impact actions follow the execution mode: a dry run and a pending
 *   action in validation mode, executed only once approved by the user in
 *   Kledg (a forged actionId is refused by every such tool), at once in
 *   automatic mode; the other actions of the same tool run at once;
 * - each tool does what its route does (French validation messages, euros
 *   in and out, audit entries).
 *
 * Run with KLEDG_RLS=enforce too (docs/rls.md). Skipped when the test
 * database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('mcp_parity')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { AccessLevel, CompanyAccess, ExecutionMode } from '@/lib/ai-access/access'

const available = await testDatabaseAvailable()

type Handler = (request: Request) => Promise<Response>

let prisma: typeof import('@/lib/prisma').prisma
let mcp: Record<'POST', Handler>
let createApiKeyWithGrant: typeof import('@/lib/ai-access/create-api-key.service').createApiKeyWithGrant

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }
const VIEWER = { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' }
const ADMIN = { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' }

/** The tools of this coverage and their level. */
const LEVEL: Record<string, AccessLevel> = {
  get_entry: 'read',
  get_ledger_report: 'read',
  list_fixed_assets: 'read',
  list_expense_category_rules: 'read',
  get_company_settings: 'read',
  get_statement_layout: 'read',
  get_transaction_details: 'read',
  simulate_rule: 'read',
  manage_tiers: 'write',
  duplicate_entry: 'write',
  update_draft_invoice: 'write',
  update_provision: 'write',
  update_investment_grant: 'write',
  update_draft_expense_report: 'write',
  reclassify_doubtful_receivable: 'write',
  save_local_taxes: 'write',
  prepare_cfe_entry: 'write',
  save_corporate_tax_inputs: 'write',
  record_tax_filing: 'write',
  save_depreciation_record: 'write',
  prepare_opening_balances: 'write',
  accept_all_expense_suggestions: 'write',
  manage_accounts: 'admin',
  manage_journals: 'admin',
  manage_fiscal_years: 'admin',
  import_accounting_file: 'admin',
  update_company_settings: 'admin',
  manage_company_records: 'admin',
  manage_statement_layout: 'admin',
  manage_members: 'admin',
  manage_bank_accounts: 'admin',
  bulk_reconcile: 'admin',
  delete_bank_transactions: 'admin',
  duplicate_rule: 'admin',
  sync_bank_data: 'admin',
  upload_receipt: 'admin',
  manage_invoice: 'admin',
  import_qonto_invoices: 'admin',
  delete_tiers: 'admin',
  delete_budget_items: 'admin',
  delete_year_end_items: 'admin',
  manage_expense_report: 'admin',
  manage_expense_settings: 'admin',
  manage_management_fee_convention: 'admin',
  auto_letter_account: 'admin',
  manage_fixed_asset: 'admin',
  manage_depreciation_record: 'admin',
}

const PROVISION = { category: 'RISK_CHARGE', label: 'Litige Martin', justification: "Estimation de l'avocat", accountCode: '1511', openedOn: '2025-03-01' }
const GRANT = { label: 'Subvention région', amount: 1000, grantedOn: '2025-02-01', spreading: 'LINEAR', durationYears: 5 }
const PDF = Buffer.from('%PDF-1.4 test').toString('base64')

/** Arguments that pass each tool's schema (ids need not exist: access is checked first). */
const ARGS: Record<string, Record<string, unknown>> = {
  get_entry: { entryId: 'x' },
  get_ledger_report: { report: 'general_ledger' },
  list_fixed_assets: {},
  list_expense_category_rules: {},
  get_company_settings: { section: 'company' },
  get_statement_layout: { statement: 'balance_sheet' },
  get_transaction_details: { transactionId: 'x' },
  simulate_rule: { ruleId: 'x', transactionExample: { amount: 10, side: 'debit' } },
  manage_tiers: { action: 'create', tiers: { kind: 'CUSTOMER', name: 'Martin' } },
  duplicate_entry: { entryId: 'x' },
  update_draft_invoice: { invoiceId: 'x', lineAccounts: [{ id: 'x', accountCode: '606100' }] },
  update_provision: { provisionId: 'x', provision: PROVISION },
  update_investment_grant: { grantId: 'x', grant: GRANT },
  update_draft_expense_report: { reportId: 'x', report: { periodStart: '2025-03-01', periodEnd: '2025-03-31' } },
  reclassify_doubtful_receivable: { fiscalYearId: 'x', tiersCode: 'C00001' },
  save_local_taxes: { year: 2025 },
  prepare_cfe_entry: { year: 2025, kind: 'acompte' },
  save_corporate_tax_inputs: { fiscalYearId: 'x' },
  record_tax_filing: { tax: 'vat', action: 'remove', period: '2025-03' },
  save_depreciation_record: { action: 'save', fixedAssetId: 'x', record: { fiscalYearId: 'x', periodType: 'year' } },
  prepare_opening_balances: { lines: [{ accountCode: '512', debit: 1 }, { accountCode: '101', credit: 1 }] },
  accept_all_expense_suggestions: { transactionIds: ['x'] },
  manage_accounts: { action: 'complete_pcg' },
  manage_journals: { action: 'restore_defaults' },
  manage_fiscal_years: { action: 'delete', fiscalYearId: 'x' },
  import_accounting_file: { type: 'fec', fileName: 'f.txt', contentBase64: 'QQ==' },
  update_company_settings: { section: 'payment_terms', paymentTerms: { days: 30, endOfMonth: false } },
  manage_company_records: { action: 'create_address', address: { street: '1 rue de Rivoli', postalCode: '75001', city: 'Paris' } },
  manage_statement_layout: { statement: 'balance_sheet', action: 'reset_default' },
  manage_members: { action: 'remove', memberId: 'x' },
  manage_bank_accounts: { action: 'select_default', bankAccountId: null },
  bulk_reconcile: { action: 'mark_reconciled', transactionIds: ['x'] },
  delete_bank_transactions: { transactionIds: ['x'] },
  duplicate_rule: { ruleId: 'x' },
  sync_bank_data: { scope: 'qonto_receipts' },
  upload_receipt: { transactionId: 'x', fileName: 'a.pdf', contentBase64: PDF },
  manage_invoice: { action: 'settle', invoiceId: 'x' },
  import_qonto_invoices: {},
  delete_tiers: { tiersId: 'x' },
  delete_budget_items: { kind: 'budget', budgetId: 'x' },
  delete_year_end_items: { action: 'delete_grant', grantId: 'x' },
  manage_expense_report: { action: 'validate', reportId: 'x' },
  manage_expense_settings: { action: 'create_rule', rule: { keyword: 'sncf', category: 'TRANSPORT' } },
  manage_management_fee_convention: { action: 'delete', conventionId: 'x' },
  auto_letter_account: { accountCode: '411' },
  manage_fixed_asset: { action: 'delete', fixedAssetId: 'x' },
  manage_depreciation_record: { action: 'delete', fixedAssetId: 'x', recordId: 'x' },
}

/** High-impact calls (the execution mode applies): ARGS of these tools are high impact unless replaced here. */
const HIGH_IMPACT: Record<string, Record<string, unknown>> = {
  manage_accounts: { action: 'delete', accountCode: '606100' },
  manage_journals: { action: 'delete', journalCode: 'AN' },
  manage_fiscal_years: ARGS.manage_fiscal_years,
  import_accounting_file: ARGS.import_accounting_file,
  update_company_settings: ARGS.update_company_settings,
  manage_company_records: ARGS.manage_company_records,
  manage_statement_layout: ARGS.manage_statement_layout,
  manage_members: ARGS.manage_members,
  manage_bank_accounts: { action: 'disconnect', connectionId: 'x' },
  bulk_reconcile: { action: 'unreconcile', transactionIds: ['x'] },
  delete_bank_transactions: ARGS.delete_bank_transactions,
  manage_invoice: ARGS.manage_invoice,
  import_qonto_invoices: ARGS.import_qonto_invoices,
  delete_tiers: ARGS.delete_tiers,
  delete_budget_items: ARGS.delete_budget_items,
  delete_year_end_items: ARGS.delete_year_end_items,
  manage_expense_report: ARGS.manage_expense_report,
  manage_expense_settings: { action: 'delete_rule', ruleId: 'x' },
  manage_management_fee_convention: ARGS.manage_management_fee_convention,
  auto_letter_account: ARGS.auto_letter_account,
  manage_fixed_asset: ARGS.manage_fixed_asset,
  manage_depreciation_record: ARGS.manage_depreciation_record,
}

/** Writing tools a viewer may still call (expenses:submit): its own expense reports. */
const VIEWER_ALLOWED = new Set(['update_draft_expense_report'])

const CHART: Array<[string, string]> = [
  ['101', 'Capital'],
  ['120', "Résultat de l'exercice (bénéfice)"],
  ['129', "Résultat de l'exercice (perte)"],
  ['131', "Subventions d'équipement"],
  ['139', "Subventions d'investissement inscrites au compte de résultat"],
  ['151', 'Provisions pour risques'],
  ['1511', 'Provisions pour litiges'],
  ['2183', 'Matériel de bureau et matériel informatique'],
  ['28183', 'Amortissements du matériel de bureau et informatique'],
  ['401', 'Fournisseurs'],
  ['411', 'Clients'],
  ['416', 'Clients douteux ou litigieux'],
  ['421', 'Personnel, rémunérations dues'],
  ['447', 'Autres impôts, taxes et versements assimilés'],
  ['4456', 'Taxes sur le chiffre d’affaires déductibles'],
  ['44566', 'TVA sur autres biens et services'],
  ['4457', 'Taxes sur le chiffre d’affaires collectées'],
  ['44571', 'TVA collectée'],
  ['467', 'Autres comptes débiteurs ou créditeurs'],
  ['512', 'Banques'],
  ['512000', 'Banque'],
  ['606', 'Achats non stockés de matières et fournitures'],
  ['606100', 'Fournitures non stockables'],
  ['625', 'Déplacements, missions et réceptions'],
  ['6251', 'Voyages et déplacements'],
  ['63511', 'Contribution économique territoriale'],
  ['6811', 'Dotations aux amortissements sur immobilisations'],
  ['6815', 'Dotations aux provisions d’exploitation'],
  ['706', 'Prestations de services'],
  ['706000', 'Prestations de services'],
  ['777', 'Quote-part des subventions d’investissement virée au résultat'],
  ['7815', 'Reprises sur provisions d’exploitation'],
]

const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seedCompany(prefix: 'a' | 'b' | 'c', siren: string, members: Array<[string, string]>) {
  const company = await prisma.company.create({
    data: { name: `Société ${prefix.toUpperCase()}`, slug: `societe-${prefix}`, siren, legalType: 'SAS', closingDay: 31, closingMonth: 12, vatRegime: 'normal', corporateTaxRegime: 'simplified' },
  })
  await prisma.organization.create({ data: { id: `org-${prefix}`, name: company.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id } })
  for (const [userId, role] of members) {
    await prisma.member.create({ data: { id: `m-${prefix}-${userId}`, userId, organizationId: `org-${prefix}`, role, createdAt: new Date() } })
  }
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31'), closingDay: 31, closingMonth: 12 },
  })
  for (const [code, label] of CHART) {
    const account = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label, isPCG: true } })
    ids[`${prefix}:${code}`] = account.id
  }
  for (const code of ['BQ', 'OD', 'AC', 'VE', 'AN']) await prisma.journal.create({ data: { companyId: company.id, code, label: code } })
  ids[`${prefix}Company`] = company.id
  ids[`${prefix}Fy`] = fy.id
}

async function seed() {
  await prepareTestDatabase('mcp_parity')
  for (const user of [OWNER, VIEWER, ADMIN]) await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  await seedCompany('a', '123456782', [
    [OWNER.id, 'companyAdmin'],
    [VIEWER.id, 'viewer'],
  ])
  await seedCompany('b', '222222222', [[OWNER.id, 'companyAdmin']])
  await seedCompany('c', '333333333', [])
}

async function apiKey(
  level: AccessLevel,
  { access = { allCompanies: true, companyIds: [] }, user = OWNER, mode = 'automatic' }: { access?: CompanyAccess; user?: typeof OWNER; mode?: ExecutionMode } = {},
): Promise<string> {
  return (await createApiKeyWithGrant({ ...user }, `Clé ${level} ${mode}`, access, level, mode)).key
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
  return JSON.parse(raw) as { result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean }; error?: { message: string } }
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

/** A call that must succeed; the result (unwrapped from { executed, result } for the high-impact tools in automatic mode). */
async function ok(key: string, name: string, args: Record<string, unknown>) {
  const result = await call(key, name, args)
  expect(result.ok, `${name}: ${result.text}`).toBe(true)
  return result.data.executed ? result.data.result : result.data
}

async function approve(actionId: string) {
  const { decideAction } = await import('@/lib/mcp/full-control/pending-actions')
  const row = await prisma.mcpPendingAction.findUniqueOrThrow({ where: { id: actionId } })
  return decideAction(row.userId, actionId, 'approve')
}

async function draftEntry(prefix: 'a' | 'b', date: string, debit: string, credit: string, amount: string, status: 'draft' | 'validated' = 'draft') {
  const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
  const journal = await prisma.journal.findFirstOrThrow({ where: { companyId: ids[`${prefix}Company`], code: 'OD' } })
  return createEntry({
    companyId: ids[`${prefix}Company`],
    journalId: journal.id,
    date,
    description: `Écriture ${debit}/${credit}`,
    status,
    lines: [
      { accountId: ids[`${prefix}:${debit}`], debit: amount, credit: 0 },
      { accountId: ids[`${prefix}:${credit}`], debit: 0, credit: amount },
    ],
  })
}

const STATEMENT = ['Date;Libellé;Montant', '15/03/2025;PRLV FOURNITURES MARTIN;-120,00', '20/03/2025;VIR CLIENT DUPONT;1200,00'].join('\n')

/** A manual bank account with two imported transactions. */
async function bankWithTransactions(key: string) {
  const account = await ok(key, 'create_bank_account', { companyId: ids.aCompany, name: 'Compte courant', ledgerAccountCode: '512000' })
  await ok(key, 'import_statement', { companyId: ids.aCompany, bankAccountId: account.id, fileName: 'releve.csv', contentBase64: Buffer.from(STATEMENT).toString('base64') })
  const transactions = await prisma.bankTransaction.findMany({ where: { bankAccountId: account.id }, orderBy: { date: 'asc' } })
  return { bankAccountId: account.id as string, connectionId: (await prisma.bankAccount.findUniqueOrThrow({ where: { id: account.id } })).bankConnectionId, transactions }
}

/** A valid SIRET of the company A (SIREN 123456782 and a NIC passing the Luhn check). */
function siretOf(siren: string): string {
  for (let nic = 10; nic < 99999; nic++) {
    const siret = `${siren}${String(nic).padStart(5, '0')}`
    const sum = [...siret].reverse().reduce((total, digit, i) => {
      const n = Number(digit) * (i % 2 === 1 ? 2 : 1)
      return total + (n > 9 ? n - 9 : n)
    }, 0)
    if (sum % 10 === 0) return siret
  }
  throw new Error('no SIRET')
}

describe.skipIf(!available)('MCP tools covering the API', () => {
  beforeAll(async () => {
    await prepareTestDatabase('mcp_parity')
    ;({ prisma } = await import('@/lib/prisma'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as Record<'POST', Handler>
    ;({ createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service'))
  }, 60_000)

  beforeEach(seed)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('access', () => {
    it('lists each tool at its level and above, never below', async () => {
      const names = { read: await toolNames(await apiKey('read')), write: await toolNames(await apiKey('write')), admin: await toolNames(await apiKey('admin')) }
      const rank = { read: 0, write: 1, admin: 2 }
      for (const [tool, level] of Object.entries(LEVEL)) {
        for (const key of ['read', 'write', 'admin'] as const) {
          expect(names[key].includes(tool), `${tool} with a ${key} key`).toBe(rank[key] >= rank[level])
        }
      }
      expect(Object.keys(ARGS).sort()).toEqual(Object.keys(LEVEL).sort())
    })

    it('answers "Société introuvable" for a company outside the grant or of which the user is not a member', async () => {
      const onlyA = await apiKey('admin', { access: { allCompanies: false, companyIds: [ids.aCompany] } })
      for (const [tool, args] of Object.entries(ARGS)) {
        for (const companyId of [ids.bCompany, ids.cCompany]) {
          const result = await call(onlyA, tool, { companyId, ...args })
          expect(result.ok, `${tool} ${companyId}`).toBe(false)
          expect(result.text, tool).toBe('Société introuvable')
        }
      }
    })

    it('refuses a viewer every tool that writes, and lets it read', async () => {
      const viewer = await apiKey('admin', { user: VIEWER })
      for (const [tool, level] of Object.entries(LEVEL)) {
        const result = await call(viewer, tool, { companyId: ids.aCompany, ...ARGS[tool] })
        if (level === 'read' || VIEWER_ALLOWED.has(tool)) {
          expect(result.text, tool).not.toMatch(/Action non autorisée|Société introuvable/)
        } else {
          expect(result.ok, tool).toBe(false)
          expect(result.text, tool).toMatch(/^Action non autorisée : votre rôle \(Lecture seule\)/)
        }
      }
    })

    it('checks the right of each action of a grouped tool', async () => {
      const viewer = await apiKey('admin', { user: VIEWER })
      // payment_candidates only reads (entries:read), settle updates (entries:update).
      const candidates = await call(viewer, 'manage_invoice', { companyId: ids.aCompany, action: 'payment_candidates', invoiceId: 'x' })
      expect(candidates.text).not.toMatch(/Action non autorisée/)
      const settle = await call(viewer, 'manage_invoice', { companyId: ids.aCompany, action: 'settle', invoiceId: 'x' })
      expect(settle.text).toMatch(/Action non autorisée/)
    })
  })

  describe('execution mode', () => {
    it('refuses a forged actionId for every high-impact action, with nothing executed', async () => {
      const key = await apiKey('admin', { mode: 'validation' })
      for (const [tool, args] of Object.entries(HIGH_IMPACT)) {
        const result = await call(key, tool, { companyId: ids.aCompany, ...args, actionId: 'forged-action' })
        expect(result.ok, tool).toBe(false)
        expect(result.text, tool).toMatch(/introuvable|expirée/)
      }
      const refused = await prisma.auditLog.count({ where: { action: 'MCP_FULL_CONTROL_REFUSED' } })
      expect(refused).toBe(Object.keys(HIGH_IMPACT).length)
      expect(await prisma.auditLog.count({ where: { action: 'MCP_FULL_CONTROL' } })).toBe(0)
    })

    it('in validation mode, previews and waits for the approval in Kledg, then acts once', async () => {
      const key = await apiKey('admin', { mode: 'validation' })
      const args = { companyId: ids.aCompany, action: 'delete', journalCode: 'AN' }
      const dry = await call(key, 'manage_journals', args)
      expect(dry.ok, dry.text).toBe(true)
      expect(dry.data).toMatchObject({ dryRun: true, preview: { action: 'delete', journal: { code: 'AN', entries: 0 } } })
      expect(await prisma.journal.count({ where: { companyId: ids.aCompany, code: 'AN' } })).toBe(1)

      const early = await call(key, 'manage_journals', { ...args, actionId: dry.data.actionId })
      expect(early.ok).toBe(false)
      await approve(dry.data.actionId)
      const done = await call(key, 'manage_journals', { ...args, actionId: dry.data.actionId })
      expect(done.data).toEqual({ executed: true, result: { action: 'delete', deleted: 'AN' } })
      expect(await prisma.journal.count({ where: { companyId: ids.aCompany, code: 'AN' } })).toBe(0)
      expect((await call(key, 'manage_journals', { ...args, actionId: dry.data.actionId })).ok).toBe(false)

      // An action of the same tool that is not high impact runs at once.
      const renamed = await call(key, 'manage_journals', { companyId: ids.aCompany, action: 'update', journalCode: 'OD', label: 'Opérations diverses' })
      expect(renamed.data).toEqual({ executed: true, result: { action: 'update', journal: { code: 'OD', label: 'Opérations diverses' } } })
      const audit = await prisma.auditLog.findMany({ where: { action: 'MCP_FULL_CONTROL' } })
      expect(audit.map((r) => (r.metadata as { action: string }).action).sort()).toEqual(['delete', 'update'])
    })

    it('in automatic mode, executes at once, and previews only on dryRun', async () => {
      const key = await apiKey('admin')
      const preview = await call(key, 'manage_journals', { companyId: ids.aCompany, action: 'delete', journalCode: 'AN', dryRun: true })
      expect(preview.data.dryRun).toBe(true)
      expect(await prisma.journal.count({ where: { companyId: ids.aCompany, code: 'AN' } })).toBe(1)
      const done = await call(key, 'manage_journals', { companyId: ids.aCompany, action: 'delete', journalCode: 'AN' })
      expect(done.data).toEqual({ executed: true, result: { action: 'delete', deleted: 'AN' } })
      const restored = await ok(key, 'manage_journals', { companyId: ids.aCompany, action: 'restore_defaults' })
      expect(restored.created).toEqual(['AN'])
      const audit = await prisma.auditLog.findMany({ where: { action: 'MCP_FULL_CONTROL' } })
      expect(audit.map((r) => (r.metadata as { executionMode: string }).executionMode)).toEqual(['automatic', 'automatic'])
    })
  })

  describe('books', () => {
    it('reads an entry, the general ledger and the journal, in euros', async () => {
      const key = await apiKey('read')
      const entry = await draftEntry('a', '2025-03-10', '606100', '512000', '12.50', 'validated')
      const read = await ok(key, 'get_entry', { companyId: ids.aCompany, entryId: entry.id })
      expect(read).toMatchObject({ id: entry.id, status: 'validated', date: '2025-03-10' })
      expect(read.lines.map((l: { debit: number; credit: number }) => [l.debit, l.credit]).sort()).toEqual([
        [0, 12.5],
        [12.5, 0],
      ])
      const ledger = await ok(key, 'get_ledger_report', { companyId: ids.aCompany, report: 'general_ledger', fiscalYearId: ids.aFy, accountPrefix: '606' })
      expect(ledger.accounts.map((a: { account: { code: string } }) => a.account.code)).toEqual(['606100'])
      expect(ledger.truncated).toBe(false)
      const journal = await ok(key, 'get_ledger_report', { companyId: ids.aCompany, report: 'journal', startDate: '2025-01-01', endDate: '2025-12-31' })
      expect(journal.journals[0].entries).toHaveLength(1)
      const missing = await call(key, 'get_entry', { companyId: ids.aCompany, entryId: (await draftEntry('b', '2025-03-10', '606', '512', '1')).id })
      expect(missing.text).toBe('Écriture introuvable')
    })

    it('copies an entry as a draft and books opening balances as a draft', async () => {
      const key = await apiKey('write')
      const entry = await draftEntry('a', '2025-03-10', '606100', '512000', '12.50', 'validated')
      const copy = await ok(key, 'duplicate_entry', { companyId: ids.aCompany, entryId: entry.id })
      expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: copy.entryId } })).status).toBe('draft')

      const unbalanced = await call(key, 'prepare_opening_balances', { companyId: ids.aCompany, lines: [{ accountCode: '512', debit: 1000 }, { accountCode: '101', credit: 999 }] })
      expect(unbalanced.ok).toBe(false)
      const opening = await ok(key, 'prepare_opening_balances', { companyId: ids.aCompany, lines: [{ accountCode: '512', debit: 1000.5 }, { accountCode: '101', credit: 1000.5 }] })
      const booked = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: opening.entryId }, include: { lines: true, journal: true } })
      expect(booked.status).toBe('draft')
      expect(booked.journal.code).toBe('AN')
      expect(booked.lines.map((l) => Number(l.debit) + Number(l.credit))).toEqual([1000.5, 1000.5])
      const audit = await prisma.auditLog.findMany({ where: { action: 'MCP_WRITE' } })
      expect(audit.map((r) => (r.metadata as { tool: string }).tool).sort()).toEqual(['duplicate_entry', 'prepare_opening_balances'])
    })

    it('manages the chart of accounts, the journals and the fiscal years', async () => {
      const key = await apiKey('admin')
      // Accounts created under a PCG account are PCG accounts too: a free account is not.
      await prisma.account.create({ data: { companyId: ids.aCompany, fiscalYearId: ids.aFy, code: '6061001', label: 'Électricité', isPCG: false } })
      const renamed = await ok(key, 'manage_accounts', { companyId: ids.aCompany, action: 'update', accountCode: '6061001', label: 'Électricité et gaz' })
      expect(renamed.account).toMatchObject({ code: '6061001', label: 'Électricité et gaz' })
      const refused = await call(key, 'manage_accounts', { companyId: ids.aCompany, action: 'delete', accountCode: '606100' })
      expect(refused.text).toBe('Impossible de supprimer un compte du PCG')
      await ok(key, 'manage_accounts', { companyId: ids.aCompany, action: 'delete', accountCode: '6061001' })
      expect(await prisma.account.count({ where: { companyId: ids.aCompany, code: '6061001' } })).toBe(0)
      const completed = await ok(key, 'manage_accounts', { companyId: ids.aCompany, action: 'complete_pcg' })
      expect(completed.addedCount).toBeGreaterThan(0)
      await prisma.account.create({ data: { companyId: ids.aCompany, fiscalYearId: ids.aFy, code: '6061002', label: 'Eau', isPCG: false } })
      const nonPcg = await call(key, 'manage_accounts', { companyId: ids.aCompany, action: 'delete_non_pcg', dryRun: true })
      expect(nonPcg.data.preview.accountsToDelete).toEqual([{ code: '6061002', label: 'Eau' }])
      expect((await ok(key, 'manage_accounts', { companyId: ids.aCompany, action: 'delete_non_pcg' })).deletedCount).toBe(1)

      const created = await ok(key, 'manage_fiscal_years', { companyId: ids.aCompany, action: 'create', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' })
      const fy2026 = created.fiscalYear.id
      const moved = await ok(key, 'manage_fiscal_years', { companyId: ids.aCompany, action: 'update_dates', fiscalYearId: fy2026, startDate: '2026-01-01', endDate: '2027-03-31' })
      expect(moved.fiscalYear.endDate).toBe('2027-03-31')
      await ok(key, 'manage_fiscal_years', { companyId: ids.aCompany, action: 'delete', fiscalYearId: fy2026 })
      expect(await prisma.fiscalYear.count({ where: { companyId: ids.aCompany } })).toBe(1)
      const ofB = await call(key, 'manage_fiscal_years', { companyId: ids.aCompany, action: 'delete', fiscalYearId: ids.bFy })
      expect(ofB.ok).toBe(false)
      expect(await prisma.fiscalYear.count({ where: { id: ids.bFy } })).toBe(1)
    })

    it('imports a FEC file, with the fiscal years in the dry run', async () => {
      const key = await apiKey('admin')
      const fec = [
        'JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise',
        'OD\tOpérations diverses\t1\t20250310\t606100\tFournitures\t\t\tF1\t20250310\tFournitures\t25,00\t0,00\t\t\t20250310\t\t',
        'OD\tOpérations diverses\t1\t20250310\t512000\tBanque\t\t\tF1\t20250310\tFournitures\t0,00\t25,00\t\t\t20250310\t\t',
      ].join('\r\n')
      const args = { companyId: ids.aCompany, type: 'fec', fileName: '123456782FEC20251231.txt', contentBase64: Buffer.from(fec).toString('base64') }
      const dry = await call(key, 'import_accounting_file', { ...args, dryRun: true })
      expect(dry.ok, dry.text).toBe(true)
      expect(JSON.stringify(dry.data.preview)).toContain('2025')
      const imported = await ok(key, 'import_accounting_file', args)
      expect(imported.entriesCreated).toBe(1)
      const empty = await call(key, 'import_accounting_file', { ...args, contentBase64: '' })
      expect(empty.ok).toBe(false)
    })
  })

  describe('tiers and invoices', () => {
    it('creates and updates a customer, attaches auxiliary accounts and deletes a tiers', async () => {
      const writer = await apiKey('write')
      const invalid = await call(writer, 'manage_tiers', { companyId: ids.aCompany, action: 'create', tiers: { kind: 'CUSTOMER' } })
      expect(invalid.ok).toBe(false)
      expect(invalid.text).toMatch(/nom est requis/)
      const created = await ok(writer, 'manage_tiers', { companyId: ids.aCompany, action: 'create', tiers: { kind: 'CUSTOMER', name: 'Martin', defaultVatRate: 20, paymentTerms: { days: 30 } } })
      expect(created.changes).toMatchObject({ name: 'Martin', defaultVatRate: 20 })
      expect((await prisma.tiers.findUniqueOrThrow({ where: { id: created.tiersId } })).defaultVatRateBp).toBe(2000)
      const updated = await ok(writer, 'manage_tiers', { companyId: ids.aCompany, action: 'update', tiersId: created.tiersId, tiers: { name: 'Martin SARL' } })
      expect(updated.changes.name).toBe('Martin SARL')
      await ok(writer, 'manage_tiers', { companyId: ids.aCompany, action: 'attach_auxiliary' })

      const admin = await apiKey('admin')
      await ok(admin, 'delete_tiers', { companyId: ids.aCompany, tiersId: created.tiersId })
      expect(await prisma.tiers.count({ where: { id: created.tiersId } })).toBe(0)
    })

    it('edits a draft invoice, posts it, unposts it and deletes it', async () => {
      const admin = await apiKey('admin')
      const writer = await apiKey('write')
      const tiers = await ok(writer, 'manage_tiers', { companyId: ids.aCompany, action: 'create', tiers: { kind: 'SUPPLIER', name: 'Fournitures Martin' } })
      const invoice = await ok(admin, 'create_draft_invoice', {
        companyId: ids.aCompany,
        direction: 'PURCHASE',
        tiers: tiers.tiersId,
        number: 'F-001',
        issueDate: '2025-03-15',
        lines: [{ label: 'Papier', quantity: 1, unitPrice: 100, vatRate: 20, accountCode: '606100' }],
      })
      const invoiceId = invoice.invoice?.id ?? invoice.invoiceId ?? invoice.id
      expect(invoiceId).toBeTruthy()
      const edited = await ok(writer, 'update_draft_invoice', {
        companyId: ids.aCompany,
        invoiceId,
        invoice: { direction: 'PURCHASE', tiersId: tiers.tiersId, number: 'F-001', issueDate: '2025-03-16', lines: [{ label: 'Papier', quantity: '2', unitPrice: 100, vatRate: 20, accountCode: '606100' }] },
      })
      expect(edited.changes.totalExclTax).toBe(200)

      const posted = await ok(admin, 'manage_invoice', { companyId: ids.aCompany, action: 'post', invoiceId })
      expect(posted.action).toBe('post')
      const blocked = await call(writer, 'update_draft_invoice', { companyId: ids.aCompany, invoiceId, invoice: { number: 'F-002' } })
      expect(blocked.ok).toBe(false)
      await ok(admin, 'manage_invoice', { companyId: ids.aCompany, action: 'unpost', invoiceId })
      await ok(admin, 'manage_invoice', { companyId: ids.aCompany, action: 'delete', invoiceId })
      expect(await prisma.invoice.count({ where: { id: invoiceId } })).toBe(0)
    })

    it('answers in French when Qonto is not connected', async () => {
      const admin = await apiKey('admin')
      const result = await call(admin, 'import_qonto_invoices', { companyId: ids.aCompany })
      expect(result.ok).toBe(false)
      expect(result.text).toMatch(/Qonto/)
    })
  })

  describe('banking', () => {
    it('reconciles in bulk, applies a rule, copies a rule and deletes transactions', async () => {
      const key = await apiKey('admin')
      const { bankAccountId, connectionId, transactions } = await bankWithTransactions(key)
      const [debit, credit] = transactions

      const details = await ok(await apiKey('read'), 'get_transaction_details', { companyId: ids.aCompany, transactionId: debit.id })
      expect(JSON.stringify(details)).toContain('120')

      const marked = await ok(key, 'bulk_reconcile', { companyId: ids.aCompany, action: 'mark_reconciled', transactionIds: [credit.id] })
      expect(marked).toMatchObject({ done: 1, failed: 0 })
      const undone = await ok(key, 'bulk_reconcile', { companyId: ids.aCompany, action: 'unreconcile', transactionIds: [credit.id] })
      expect(undone).toMatchObject({ done: 1 })

      const rule = await ok(key, 'create_rule', {
        companyId: ids.aCompany,
        name: 'Fournitures',
        conditions: [{ conditionType: 'label', operator: 'contains', value: 'FOURNITURES' }],
        entryLines: [{ accountCode: '606100', lineType: 'auto', amountType: 'full' }],
      })
      const copy = await ok(key, 'duplicate_rule', { companyId: ids.aCompany, ruleId: rule.id })
      expect(copy.ruleId).not.toBe(rule.id)
      expect(copy.enabled).toBe(false)
      const simulated = await ok(await apiKey('read'), 'simulate_rule', { companyId: ids.aCompany, ruleId: rule.id, transactionExample: { amount: 120, side: 'debit', label: 'PRLV FOURNITURES' } })
      expect(JSON.stringify(simulated)).toContain('606100')
      const applied = await ok(key, 'bulk_reconcile', { companyId: ids.aCompany, action: 'apply_rule', transactionId: debit.id, ruleId: rule.id })
      expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: applied.entryId } })).status).toBe('draft')
      expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: debit.id } })).reconciled).toBe(true)
      await ok(key, 'bulk_reconcile', { companyId: ids.aCompany, action: 'unreconcile', transactionIds: [debit.id] })

      const renamed = await ok(key, 'manage_bank_accounts', { companyId: ids.aCompany, action: 'update', bankAccountId, displayName: 'Banque principale' })
      expect(renamed.account.displayName).toBe('Banque principale')
      const preview = await call(key, 'manage_bank_accounts', { companyId: ids.aCompany, action: 'disconnect', connectionId, dryRun: true })
      expect(preview.data.preview.connection.id).toBe(connectionId)

      const deleted = await ok(key, 'delete_bank_transactions', { companyId: ids.aCompany, transactionIds: [debit.id] })
      expect(deleted).toMatchObject({ deleted: 1, failed: 0 })
      expect(await prisma.bankTransaction.count({ where: { id: debit.id } })).toBe(0)
    })

    it('simulates a rule being written, in euros', async () => {
      const key = await apiKey('read')
      const result = await ok(key, 'simulate_rule', {
        companyId: ids.aCompany,
        ruleData: { entryLines: [{ accountCode: '606100', lineType: 'debit', amountType: 'percentage', amountValue: 100 }] },
        transactionExample: { amount: 120, side: 'debit' },
      })
      expect(JSON.stringify(result)).toContain('606100')
    })

    it('refuses to send a receipt of a bank that is not Qonto, in French, and syncs nothing without integration', async () => {
      const key = await apiKey('admin')
      const { transactions } = await bankWithTransactions(key)
      const receipt = await call(key, 'upload_receipt', { companyId: ids.aCompany, transactionId: transactions[0].id, fileName: 'facture.pdf', contentBase64: PDF })
      expect(receipt.ok).toBe(false)
      expect(receipt.text).toMatch(/banque/)
      const wrongType = await call(key, 'upload_receipt', { companyId: ids.aCompany, transactionId: transactions[0].id, fileName: 'facture.exe', contentBase64: PDF })
      expect(wrongType.text).toBe('Type de fichier non autorisé. Seuls JPEG, PNG et PDF sont acceptés.')
      const status = await ok(await apiKey('read'), 'get_bank_sync_status', { companyId: ids.aCompany })
      expect(status.integrations).toEqual([])
      const sync = await call(key, 'sync_bank_data', { companyId: ids.aCompany, scope: 'integration' })
      expect(sync.text).toBe('integrationId est requis pour cette synchronisation.')
    })

    it('classes the sure expenses as drafts only', async () => {
      const key = await apiKey('admin')
      const { transactions } = await bankWithTransactions(key)
      const writer = await apiKey('write')
      const result = await ok(writer, 'accept_all_expense_suggestions', { companyId: ids.aCompany, transactionIds: transactions.map((t) => t.id) })
      expect(result.changes).toBeTruthy()
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany, status: 'validated' } })).toBe(0)
    })
  })

  describe('settings', () => {
    it('reads and changes the company settings and its records', async () => {
      const reader = await apiKey('read')
      const company = await ok(reader, 'get_company_settings', { companyId: ids.aCompany, section: 'company' })
      expect(company).toMatchObject({ name: 'Société A', siren: '123456782', hasLogo: false })
      expect(company).not.toHaveProperty('logo')

      const admin = await apiKey('admin')
      const renamed = await ok(admin, 'update_company_settings', { companyId: ids.aCompany, section: 'company', company: { name: 'Société Alpha' } })
      expect(renamed.company.name).toBe('Société Alpha')
      await ok(admin, 'update_company_settings', { companyId: ids.aCompany, section: 'payment_terms', paymentTerms: { days: 45, endOfMonth: false } })
      expect(await ok(reader, 'get_company_settings', { companyId: ids.aCompany, section: 'payment_terms' })).toMatchObject({ days: 45 })
      const tooLong = await call(admin, 'update_company_settings', { companyId: ids.aCompany, section: 'payment_terms', paymentTerms: { days: 90, endOfMonth: false } })
      expect(tooLong.ok).toBe(false)

      const siret = siretOf('123456782')
      const establishment = await ok(admin, 'manage_company_records', {
        companyId: ids.aCompany,
        action: 'create_establishment',
        establishment: { siret, name: 'Siège', address: { street: '1 rue de Rivoli', postalCode: '75001', city: 'Paris' } },
      })
      expect(establishment.siret).toBe(siret)
      const regime = await ok(admin, 'manage_company_records', { companyId: ids.aCompany, action: 'add_tax_regime', taxRegime: { regimeType: 'vat', regime: 'normal', startDate: '2025-01-01' } })
      await ok(admin, 'manage_company_records', { companyId: ids.aCompany, action: 'delete_tax_regime', taxRegimeId: regime.id })
      const regimes = await ok(reader, 'get_company_settings', { companyId: ids.aCompany, section: 'tax_regimes' })
      expect(JSON.stringify(regimes)).not.toContain(regime.id)
    })

    it('waits for the approval in Kledg before changing a setting, in validation mode', async () => {
      const key = await apiKey('admin', { mode: 'validation' })
      const args = { companyId: ids.aCompany, section: 'simple_mode', simpleMode: { accountantReview: true } }
      const dry = await call(key, 'update_company_settings', args)
      expect(dry.data).toMatchObject({ dryRun: true, preview: { section: 'simple_mode', requested: { accountantReview: true } } })
      await approve(dry.data.actionId)
      const done = await call(key, 'update_company_settings', { ...args, actionId: dry.data.actionId })
      expect(done.data.result.simpleMode).toMatchObject({ accountantReview: true })
      expect(await prisma.auditLog.count({ where: { action: 'UPDATE_SIMPLE_MODE_SETTINGS' } })).toBe(1)

      const person = await ok(await apiKey('admin'), 'manage_company_records', { companyId: ids.aCompany, action: 'create_person', person: { firstName: 'Jeanne', name: 'Martin' } })
      const holder = await ok(await apiKey('admin'), 'manage_company_records', { companyId: ids.aCompany, action: 'create_shareholder', shareholder: { type: 'PHYSICAL', sharePercentage: 60, personId: person.id } })
      const shareholders = await ok(await apiKey('read'), 'get_company_settings', { companyId: ids.aCompany, section: 'shareholders' })
      expect(JSON.stringify(shareholders)).toContain(holder.id)
    })

    it('changes the layout of the statements', async () => {
      const admin = await apiKey('admin')
      await ok(admin, 'manage_statement_layout', { companyId: ids.aCompany, statement: 'income_statement', action: 'reset_default' })
      const layout = await ok(await apiKey('read'), 'get_statement_layout', { companyId: ids.aCompany, statement: 'income_statement' })
      expect(JSON.stringify(layout).length).toBeGreaterThan(100)
      const line = await ok(admin, 'manage_statement_layout', {
        companyId: ids.aCompany,
        statement: 'income_statement',
        action: 'create_line',
        line: { lineLabel: 'Énergie', section: 'charges', accountCodes: ['6061'], balanceType: 'debit', order: 99 },
      })
      expect(line.lineLabel).toBe('Énergie')
      await ok(admin, 'manage_statement_layout', { companyId: ids.aCompany, statement: 'income_statement', action: 'delete_line', lineId: line.id })
      const bsOnly = await call(admin, 'manage_statement_layout', { companyId: ids.aCompany, statement: 'income_statement', action: 'apply_template', templateId: 'x' })
      expect(bsOnly.text).toBe('Cette action existe pour le bilan seulement.')
    })

    it('manages the members for an instance administrator only', async () => {
      const owner = await apiKey('admin')
      const refused = await call(owner, 'manage_members', { companyId: ids.aCompany, action: 'add', email: 'new@test.local', role: 'viewer' })
      expect(refused.text).toBe("Action réservée aux administrateurs de l'instance.")
      const admin = await apiKey('admin', { user: ADMIN })
      const added = await ok(admin, 'manage_members', { companyId: ids.aCompany, action: 'add', email: 'new@test.local', name: 'Nouveau', role: 'viewer' })
      await ok(admin, 'manage_members', { companyId: ids.aCompany, action: 'update_role', memberId: added.memberId, role: 'accountant' })
      const members = await ok(await apiKey('read'), 'get_company_settings', { companyId: ids.aCompany, section: 'members' })
      expect(JSON.stringify(members)).toContain('new@test.local')
      await ok(admin, 'manage_members', { companyId: ids.aCompany, action: 'remove', memberId: added.memberId })
      expect(await prisma.member.count({ where: { id: added.memberId } })).toBe(0)
      const audit = await prisma.auditLog.findMany({ where: { action: { in: ['MEMBER_ADDED', 'MEMBER_ROLE_CHANGED', 'MEMBER_REMOVED'] } } })
      expect(audit).toHaveLength(3)
    })
  })

  describe('year-end, taxes and fixed assets', () => {
    it('updates and deletes provisions, assessments and grants', async () => {
      const writer = await apiKey('write')
      const provision = await ok(writer, 'create_provision', { companyId: ids.aCompany, ...PROVISION })
      const updated = await ok(writer, 'update_provision', { companyId: ids.aCompany, provisionId: provision.provisionId, provision: { ...PROVISION, label: 'Litige Martin et fils', alreadyBooked: undefined, carried: 100 } })
      expect(updated.changes.label).toBe('Litige Martin et fils')
      await ok(writer, 'record_provision_assessment', { companyId: ids.aCompany, provisionId: provision.provisionId, fiscalYearId: ids.aFy, requiredBalance: 500 })
      const grant = await ok(writer, 'create_investment_grant', { companyId: ids.aCompany, label: 'Subvention', amount: 1000, grantedOn: '2025-02-01', spreading: 'LINEAR', durationYears: 5 })
      const grantId = grant.grantId ?? grant.changes?.grantCreated
      const grantUpdated = await ok(writer, 'update_investment_grant', { companyId: ids.aCompany, grantId, grant: { ...GRANT, amount: 1500.5 } })
      expect(grantUpdated.changes.amount).toBe(1500.5)

      const admin = await apiKey('admin')
      await ok(admin, 'delete_year_end_items', { companyId: ids.aCompany, action: 'delete_assessment', provisionId: provision.provisionId, fiscalYearId: ids.aFy })
      await ok(admin, 'delete_year_end_items', { companyId: ids.aCompany, action: 'delete_provision', provisionId: provision.provisionId })
      await ok(admin, 'delete_year_end_items', { companyId: ids.aCompany, action: 'delete_grant', grantId })
      expect(await prisma.provision.count()).toBe(0)
      expect(await prisma.investmentGrant.count()).toBe(0)
    })

    it('records the data of the local and corporate taxes and the filings', async () => {
      const writer = await apiKey('write')
      const saved = await ok(writer, 'save_local_taxes', { companyId: ids.aCompany, year: 2025, cfe: { total: 1234.56, acompte: 617.28, noticeOn: '2025-05-15' } })
      expect(saved.changes.year).toBe(2025)
      const local = await ok(await apiKey('read'), 'get_local_taxes', { companyId: ids.aCompany, year: 2025 })
      expect(JSON.stringify(local)).toContain('1234.56')
      const cfe = await call(writer, 'prepare_cfe_entry', { companyId: ids.aCompany, year: 2025, kind: 'acompte' })
      expect(cfe.ok, cfe.text).toBe(true)

      const inputs = await ok(writer, 'save_corporate_tax_inputs', { companyId: ids.aCompany, fiscalYearId: ids.aFy, deficitsOpening: 1000.25, capitalPaidUp: true })
      expect(inputs.changes).toBeTruthy()
      const filing = await ok(writer, 'record_tax_filing', {
        companyId: ids.aCompany,
        tax: 'corporate_tax',
        corporateTax: { fiscalYearId: ids.aFy, filedOn: '2026-05-15', resultBeforeDeficits: 5000, deficitsImputed: 1000.25, corporateTax: 600, reducedRate: true },
      })
      expect(filing.message).toMatch(/Dépôt enregistré/)
      await ok(writer, 'record_tax_filing', { companyId: ids.aCompany, tax: 'corporate_tax', action: 'remove', fiscalYearId: ids.aFy })
      const badAmount = await call(writer, 'save_corporate_tax_inputs', { companyId: ids.aCompany, fiscalYearId: ids.aFy, deficitsOpening: 10.001 })
      expect(badAmount.text).toBe('deficitsOpening : montant invalide, en euros avec deux décimales au plus.')
    })

    it('records, books and deletes depreciation, then changes and deletes the fixed asset', async () => {
      const admin = await apiKey('admin')
      const asset = await ok(admin, 'create_fixed_asset', {
        companyId: ids.aCompany,
        label: 'Ordinateur',
        acquisitionDate: '2025-01-01',
        acquisitionValue: 1200,
        depreciationMethod: 'linear',
        depreciationDuration: 3,
        assetAccountCode: '2183',
        depreciationAccountCode: '28183',
        expenseAccountCode: '6811',
      })
      const list = await ok(await apiKey('read'), 'list_fixed_assets', { companyId: ids.aCompany })
      expect(list.assets).toHaveLength(1)
      const writer = await apiKey('write')
      const record = await ok(writer, 'save_depreciation_record', { companyId: ids.aCompany, action: 'save', fixedAssetId: asset.id, record: { fiscalYearId: ids.aFy, periodType: 'year' } })
      const recordId = record.changes.id
      expect(recordId).toBeTruthy()
      const booked = await ok(admin, 'manage_depreciation_record', { companyId: ids.aCompany, action: 'post', fixedAssetId: asset.id, recordId })
      expect(booked.action).toBe('post')
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany, status: 'validated' } })).toBe(1)
      const refused = await call(admin, 'manage_fixed_asset', { companyId: ids.aCompany, action: 'delete', fixedAssetId: asset.id })
      expect(refused.ok).toBe(false)
      const renamed = await ok(admin, 'manage_fixed_asset', { companyId: ids.aCompany, action: 'update', fixedAssetId: asset.id, fields: { label: 'Ordinateur portable' } })
      expect(renamed.fixedAsset.label).toBe('Ordinateur portable')
    })

    it('letters a third-party account automatically', async () => {
      const admin = await apiKey('admin')
      const result = await call(admin, 'auto_letter_account', { companyId: ids.aCompany, accountCode: '411' })
      expect(result.ok, result.text).toBe(true)
      expect(result.data.executed).toBe(true)
    })

    it('answers a reclassification without receivable in French', async () => {
      const writer = await apiKey('write')
      const result = await call(writer, 'reclassify_doubtful_receivable', { companyId: ids.aCompany, fiscalYearId: ids.aFy, tiersCode: 'C00001' })
      expect(result.ok).toBe(false)
      expect(result.text).not.toMatch(/internal|interne/i)
    })
  })

  describe('budgets, expense reports and conventions', () => {
    it('deletes a budget line and a budget', async () => {
      const writer = await apiKey('write')
      await ok(writer, 'create_budget', { companyId: ids.aCompany, fiscalYearId: ids.aFy })
      const line = await ok(writer, 'create_budget_line', { companyId: ids.aCompany, fiscalYearId: ids.aFy, accountPrefix: '606', amounts: [{ month: '2025-01', amount: 100 }] })
      const admin = await apiKey('admin')
      await ok(admin, 'delete_budget_items', { companyId: ids.aCompany, kind: 'line', lineId: line.line.id })
      const budget = await prisma.budget.findFirstOrThrow({ where: { companyId: ids.aCompany } })
      await ok(admin, 'delete_budget_items', { companyId: ids.aCompany, kind: 'budget', budgetId: budget.id })
      expect(await prisma.budget.count()).toBe(0)
    })

    it('edits an expense report and moves it through its workflow', async () => {
      const writer = await apiKey('write')
      const created = await ok(writer, 'create_draft_expense_report', {
        companyId: ids.aCompany,
        periodStart: '2025-03-01',
        periodEnd: '2025-03-31',
        expenses: [{ date: '2025-03-10', label: 'Train Paris Lyon', category: 'TRANSPORT', amountPaid: 80, vatRate: 10 }],
      })
      const reportId = created.reportId ?? created.changes?.reportCreated ?? created.report?.id
      expect(reportId).toBeTruthy()
      const edited = await ok(writer, 'update_draft_expense_report', {
        companyId: ids.aCompany,
        reportId,
        report: { periodStart: '2025-03-01', periodEnd: '2025-03-31', label: 'Mars', lines: [{ date: '2025-03-10', label: 'Train Paris Lyon', category: 'TRANSPORT', amountInclTax: 90.5, vatRate: 10, receiptKind: 'RECEIPT' }] },
      })
      expect(JSON.stringify(edited.changes)).toContain('90.5')

      const admin = await apiKey('admin')
      for (const action of ['submit', 'validate', 'post'] as const) await ok(admin, 'manage_expense_report', { companyId: ids.aCompany, action, reportId })
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany, status: 'draft' } })).toBe(1)
      await ok(admin, 'manage_expense_report', { companyId: ids.aCompany, action: 'unpost', reportId })
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany } })).toBe(0)
    })

    it('manages the claimants and the category rules of the expense reports', async () => {
      const admin = await apiKey('admin')
      const rule = await ok(admin, 'manage_expense_settings', { companyId: ids.aCompany, action: 'create_rule', rule: { keyword: 'sncf', category: 'TRANSPORT' } })
      const rules = await ok(await apiKey('read'), 'list_expense_category_rules', { companyId: ids.aCompany })
      expect(rules.rules.map((r: { keyword: string }) => r.keyword)).toEqual(['sncf'])
      await ok(admin, 'manage_expense_settings', { companyId: ids.aCompany, action: 'delete_rule', ruleId: rule.rule.id })
      const claimant = await ok(admin, 'manage_expense_settings', { companyId: ids.aCompany, action: 'create_claimant', claimant: { kind: 'EMPLOYEE', name: 'Jeanne Martin' } })
      expect(claimant.claimant.name).toBe('Jeanne Martin')
      const options = await ok(admin, 'manage_expense_settings', { companyId: ids.aCompany, action: 'claimant_options' })
      expect(options).toBeTruthy()
    })

    it('refuses a convention without subsidiary in French', async () => {
      const admin = await apiKey('admin')
      const result = await call(admin, 'manage_management_fee_convention', { companyId: ids.aCompany, action: 'create', convention: { label: 'Convention', startDate: '2025-01-01', subsidiaries: [] } })
      expect(result.ok).toBe(false)
      expect(result.text).toMatch(/filiale/)
      const listed = await ok(await apiKey('read'), 'list_management_fee_conventions', { companyId: ids.aCompany, view: 'subsidiaries' })
      expect(listed.subsidiaries).toEqual([])
    })
  })
})
