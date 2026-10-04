/**
 * Full control MCP tools (kledg:admin) against PostgreSQL, called through the
 * real /api/mcp handler with API keys of each level (session mocked, Better
 * Auth, services, triggers and audit log real):
 * - the tools exist only with full control;
 * - validation mode: dry run, then the user's approval in Kledg, then
 *   execution of each high-impact tool: the assistant cannot approve, an
 *   action runs once, only approved, before expiry, for its arguments, tool,
 *   company, connection and user;
 * - automatic mode: high-impact tools execute on the call (optional dry
 *   run), audited as such, with every other check kept; a change of mode
 *   applies to the next call;
 * - company grants and roles, audit entries, rate limit;
 * - an end-to-end year: import a statement, run the rules, reconcile by hand,
 *   validate the drafts, book depreciation, close the year, allocate the
 *   result and export a valid FEC.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('mcp_full_control')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  delete process.env.RATE_LIMIT_DISABLED
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
let registerKledgTools: typeof import('@/lib/mcp/tools').registerKledgTools

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }
const VIEWER = { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' }

const FULL_CONTROL_TOOLS = [
  'validate_entries',
  'reverse_entry',
  'update_draft_entry',
  'delete_draft_entry',
  'reconcile_transaction',
  'unreconcile_transaction',
  'run_rules',
  'list_rules',
  'create_rule',
  'update_rule',
  'delete_rule',
  'list_bank_accounts',
  'create_bank_account',
  'sync_bank',
  'import_statement',
  'create_account',
  'create_journal',
  'create_fixed_asset',
  'generate_depreciation',
  'close_fiscal_year',
  'allocate_result',
  'export_fec',
]

const CHART: Array<[string, string]> = [
  ['101', 'Capital'],
  ['120', "Résultat de l'exercice (bénéfice)"],
  ['129', "Résultat de l'exercice (perte)"],
  ['2183', 'Matériel de bureau et matériel informatique'],
  ['28183', 'Amortissements du matériel de bureau et informatique'],
  ['401', 'Fournisseurs'],
  ['411', 'Clients'],
  ['512', 'Banques'],
  ['512000', 'Banque'],
  ['606', 'Achats non stockés de matières et fournitures'],
  ['606100', 'Fournitures non stockables'],
  ['627', 'Services bancaires'],
  ['6811', 'Dotations aux amortissements sur immobilisations'],
  ['706', 'Prestations de services'],
  ['706000', 'Prestations de services'],
]

const ids = {} as Record<string, string>

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seedCompany(prefix: 'a' | 'b' | 'c', siren: string, members: Array<[string, string]>) {
  const company = await prisma.company.create({
    data: { name: `Société ${prefix.toUpperCase()}`, slug: `societe-${prefix}`, siren, legalType: 'SAS', closingDay: 31, closingMonth: 12 },
  })
  await prisma.organization.create({
    data: { id: `org-${prefix}`, name: company.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id },
  })
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
  for (const code of ['BQ', 'OD', 'AC', 'VE', 'AN']) {
    await prisma.journal.create({ data: { companyId: company.id, code, label: code } })
  }
  ids[`${prefix}Company`] = company.id
  ids[`${prefix}Fy`] = fy.id
}

async function seed() {
  await prepareTestDatabase('mcp_full_control')
  for (const user of [OWNER, VIEWER]) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  }
  await seedCompany('a', '123456782', [
    [OWNER.id, 'companyAdmin'],
    [VIEWER.id, 'viewer'],
  ])
  await seedCompany('b', '222222222', [[OWNER.id, 'companyAdmin']])
  await seedCompany('c', '333333333', [])
}

async function apiKey(
  level: AccessLevel,
  access: CompanyAccess = { allCompanies: true, companyIds: [] },
  user: typeof OWNER = OWNER,
  name = `Clé ${level}`,
  // Most tests here exercise the approval flow; the automatic mode has its own describe.
  mode: ExecutionMode = 'validation',
): Promise<string> {
  return (await createApiKeyWithGrant({ ...user }, name, access, level, mode)).key
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
    result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; isError?: boolean }
    error?: { message: string }
  }
}

async function toolNames(key: string): Promise<string[]> {
  return ((await rpc(key, 'tools/list')).result?.tools ?? []).map((t) => t.name)
}

interface CallResult {
  ok: boolean
  text: string
  // Parsed JSON of a successful call
  data: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function call(key: string, name: string, args: Record<string, unknown>): Promise<CallResult> {
  const body = await rpc(key, 'tools/call', { name, arguments: args })
  const text = body.result?.content?.[0]?.text ?? body.error?.message ?? ''
  const ok = !body.result?.isError && !body.error
  return { ok, text, data: ok ? JSON.parse(text) : {} }
}

/** The user's decision in Kledg (the approval page calls this service after checking the password). */
async function approve(actionId: string, decision: 'approve' | 'reject' = 'approve') {
  const { decideAction } = await import('@/lib/mcp/full-control/pending-actions')
  const row = await prisma.mcpPendingAction.findUniqueOrThrow({ where: { id: actionId } })
  return decideAction(row.userId, actionId, decision)
}

/** Dry run (must succeed), approval by the user in Kledg, then execution with the action id. */
async function confirmed(key: string, name: string, args: Record<string, unknown>) {
  const dry = await call(key, name, args)
  expect(dry.ok, dry.text).toBe(true)
  expect(dry.data.dryRun).toBe(true)
  await approve(dry.data.actionId)
  const done = await call(key, name, { ...args, actionId: dry.data.actionId })
  expect(done.ok, done.text).toBe(true)
  expect(done.data.executed).toBe(true)
  return { preview: dry.data.preview, result: done.data.result, actionId: dry.data.actionId as string }
}

async function draft(companyPrefix: 'a' | 'b', date: string, debitCode: string, creditCode: string, amount: string) {
  const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
  const journal = await prisma.journal.findFirstOrThrow({ where: { companyId: ids[`${companyPrefix}Company`], code: 'OD' } })
  return createEntry({
    companyId: ids[`${companyPrefix}Company`],
    journalId: journal.id,
    date,
    description: `Écriture ${debitCode}/${creditCode}`,
    lines: [
      { accountId: ids[`${companyPrefix}:${debitCode}`], debit: amount, credit: 0 },
      { accountId: ids[`${companyPrefix}:${creditCode}`], debit: 0, credit: amount },
    ],
  })
}

async function auditOf(tool: string) {
  const rows = await prisma.auditLog.findMany({ where: { action: 'MCP_FULL_CONTROL' }, orderBy: { createdAt: 'asc' } })
  return rows.filter((r) => (r.metadata as { tool?: string } | null)?.tool === tool)
}

const STATEMENT = [
  'Date;Libellé;Montant',
  '15/03/2025;PRLV FOURNITURES MARTIN;-120,00',
  '20/03/2025;VIR CLIENT DUPONT;1200,00',
  '25/03/2025;FRAIS BANCAIRES;-10,00',
].join('\n')

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

describe.skipIf(!available)('full control MCP tools', () => {
  beforeAll(async () => {
    await prepareTestDatabase('mcp_full_control')
    ;({ prisma } = await import('@/lib/prisma'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as Record<'POST', Handler>
    ;({ createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service'))
    ;({ registerKledgTools } = await import('@/lib/mcp/tools'))
  }, 60_000)

  beforeEach(seed)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('access level', () => {
    it('lists the full control tools only for a full control key', async () => {
      for (const level of ['read', 'write'] as const) {
        const names = await toolNames(await apiKey(level))
        expect(names).toContain('list_companies')
        for (const tool of FULL_CONTROL_TOOLS) expect(names, `${level}: ${tool}`).not.toContain(tool)
      }
      const admin = await toolNames(await apiKey('admin'))
      for (const tool of FULL_CONTROL_TOOLS) expect(admin, tool).toContain(tool)
    })

    it('refuses a call to a full control tool without kledg:admin', async () => {
      const writer = await apiKey('write')
      const refused = await call(writer, 'validate_entries', { companyId: ids.aCompany, entryIds: ['x'] })
      expect(refused.ok).toBe(false)
    })

    it('refuses full control in the guard even if a tool were reachable without it', async () => {
      const { companyGuard, FULL_CONTROL_REQUIRED_MESSAGE } = await import('@/lib/mcp/company-access')
      const guard = companyGuard({ user: { ...OWNER }, canWrite: true, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k' }, executionMode: 'automatic' })
      await expect(guard.requireFullControl(ids.aCompany, { entries: ['validate'] })).rejects.toThrow(FULL_CONTROL_REQUIRED_MESSAGE)
    })
  })

  describe('company grant and roles', () => {
    it('answers "Société introuvable" for a company outside the grant or of which the user is not a member', async () => {
      const onlyA = await apiKey('admin', { allCompanies: false, companyIds: [ids.aCompany] })
      const entry = await draft('b', '2025-02-01', '606', '401', '10.00')
      for (const companyId of [ids.bCompany, ids.cCompany]) {
        for (const [tool, args] of [
          ['validate_entries', { entryIds: [entry.id] }],
          ['list_rules', {}],
          ['close_fiscal_year', { fiscalYearId: ids.bFy }],
          ['create_journal', { code: 'ZZ', label: 'Test' }],
          ['export_fec', { fiscalYearId: ids.bFy }],
        ] as const) {
          const result = await call(onlyA, tool, { companyId, ...args })
          expect(result.ok, `${tool} ${companyId}`).toBe(false)
          expect(result.text).toBe('Société introuvable')
        }
      }
      // The draft of company B was not touched
      expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('draft')
    })

    it('never exceeds the role of the user in the company', async () => {
      const viewerKey = await apiKey('admin', { allCompanies: true, companyIds: [] }, VIEWER)
      const entry = await draft('a', '2025-02-01', '606', '401', '10.00')
      const refused = await call(viewerKey, 'validate_entries', { companyId: ids.aCompany, entryIds: [entry.id] })
      expect(refused.ok).toBe(false)
      expect(refused.text).not.toBe('Société introuvable')
      expect((await call(viewerKey, 'list_rules', { companyId: ids.aCompany })).ok).toBe(true)
    })

    it('does not find objects of another company through a granted company', async () => {
      const key = await apiKey('admin')
      const entryOfB = await draft('b', '2025-02-01', '606', '401', '10.00')
      const dry = await call(key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: entryOfB.id })
      expect(dry.ok).toBe(false)
      expect(dry.text).toBe('Écriture introuvable')
    })
  })

  describe('approval by the user in Kledg', () => {
    it('records a pending action the assistant cannot approve, then acts once after approval', async () => {
      const key = await apiKey('admin')
      const entry = await draft('a', '2025-02-01', '606', '401', '10.00')
      const args = { companyId: ids.aCompany, entryIds: [entry.id] }

      const dry = await call(key, 'validate_entries', args)
      expect(dry.data.preview).toMatchObject({ toValidate: 1, refused: 0, totalDebit: 10 })
      expect(dry.data.preview.entries[0]).toMatchObject({ id: entry.id, numberToAssign: '1', balanced: true })
      expect(dry.data.approvalUrl).toBe(`http://localhost:3000/settings/ai-actions?action=${dry.data.actionId}`)
      expect(dry.data).not.toHaveProperty('confirmationToken')
      expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('draft')
      expect(await auditOf('validate_entries')).toHaveLength(0)

      // The assistant has no way to approve: no tool, no token, and executing early is refused.
      const names = await toolNames(key)
      expect(names.some((n) => /approv|confirm|decide/i.test(n))).toBe(false)
      const early = await call(key, 'validate_entries', { ...args, actionId: dry.data.actionId })
      expect(early.ok).toBe(false)
      expect(early.text).toContain("attend encore l'accord")
      const legacy = await call(key, 'validate_entries', { ...args, confirm: true, confirmationToken: 'kc_forged' })
      expect(legacy.ok).toBe(true) // unknown fields are ignored: a new dry run, nothing executed
      expect(legacy.data.dryRun).toBe(true)
      expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('draft')

      await approve(dry.data.actionId)
      const done = await call(key, 'validate_entries', { ...args, actionId: dry.data.actionId })
      expect(done.data.result.validated).toEqual([{ id: entry.id, number: '1', date: '2025-02-01' }])

      const replay = await call(key, 'validate_entries', { ...args, actionId: dry.data.actionId })
      expect(replay.ok).toBe(false)
      expect(replay.text).toContain('déjà été exécutée')
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany, status: 'validated' } })).toBe(1)
      expect((await prisma.mcpPendingAction.findUniqueOrThrow({ where: { id: dry.data.actionId } })).status).toBe('executed')
    })

    it('acts once when an approved action is executed twice at the same time', async () => {
      const key = await apiKey('admin')
      const entry = await draft('a', '2025-02-01', '606', '401', '10.00')
      const { validateEntries } = await import('@/lib/accounting/services/entry-lifecycle.service')
      await validateEntries(ids.aCompany, [entry.id])
      const dry = await call(key, 'reverse_entry', { companyId: ids.aCompany, entryId: entry.id })
      await approve(dry.data.actionId)
      const args = { companyId: ids.aCompany, entryId: entry.id, actionId: dry.data.actionId }
      const results = await Promise.all([call(key, 'reverse_entry', args), call(key, 'reverse_entry', args)])
      expect(results.filter((r) => r.ok)).toHaveLength(1)
      expect(await prisma.accountingEntry.count({ where: { reversalOfId: entry.id } })).toBe(1)
    })

    it('never executes a refused or expired action', async () => {
      const key = await apiKey('admin')
      const entry = await draft('a', '2025-02-01', '606', '401', '10.00')
      const args = { companyId: ids.aCompany, entryId: entry.id }

      const refusedDry = await call(key, 'delete_draft_entry', args)
      await approve(refusedDry.data.actionId, 'reject')
      const refused = await call(key, 'delete_draft_entry', { ...args, actionId: refusedDry.data.actionId })
      expect(refused.text).toContain('refusé')

      const lateDry = await call(key, 'delete_draft_entry', args)
      await approve(lateDry.data.actionId)
      await prisma.mcpPendingAction.updateMany({ where: { id: lateDry.data.actionId }, data: { expiresAt: new Date(Date.now() - 1000) } })
      const late = await call(key, 'delete_draft_entry', { ...args, actionId: lateDry.data.actionId })
      expect(late.text).toContain('expiré')

      // Approving after expiry is refused too.
      const staleDry = await call(key, 'delete_draft_entry', args)
      await prisma.mcpPendingAction.updateMany({ where: { id: staleDry.data.actionId }, data: { expiresAt: new Date(Date.now() - 1000) } })
      await expect(approve(staleDry.data.actionId)).rejects.toThrow(/expiré/)
      expect(await prisma.accountingEntry.count({ where: { id: entry.id } })).toBe(1)
    })

    it('binds the approval to the arguments, the tool, the company, the connection and the user', async () => {
      const key = await apiKey('admin')
      const otherKey = await apiKey('admin', { allCompanies: true, companyIds: [] }, OWNER, 'Autre clé')
      const first = await draft('a', '2025-02-01', '606', '401', '10.00')
      const second = await draft('a', '2025-02-02', '606', '401', '20.00')
      const entryOfB = await draft('b', '2025-02-01', '606', '401', '10.00')
      const dry = await call(key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: first.id })
      const actionId = dry.data.actionId

      // Another user cannot decide it (the page answers "introuvable").
      const { decideAction } = await import('@/lib/mcp/full-control/pending-actions')
      await expect(decideAction(VIEWER.id, actionId, 'approve')).rejects.toThrow(/introuvable/)
      await approve(actionId)

      const foreign = await call(otherKey, 'delete_draft_entry', { companyId: ids.aCompany, entryId: first.id, actionId })
      expect(foreign.text).toContain('Action introuvable')
      const otherTool = await call(key, 'validate_entries', { companyId: ids.aCompany, entryIds: [first.id], actionId })
      expect(otherTool.text).toContain('ne correspondent pas')
      const otherArgs = await call(key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: second.id, actionId })
      expect(otherArgs.text).toContain('ne correspondent pas')
      const otherCompany = await call(key, 'delete_draft_entry', { companyId: ids.bCompany, entryId: entryOfB.id, actionId })
      expect(otherCompany.text).toContain('ne correspondent pas')
      expect(await prisma.accountingEntry.count({ where: { id: { in: [first.id, second.id, entryOfB.id] } } })).toBe(3)

      // The approved action still runs with its own arguments.
      const done = await call(key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: first.id, actionId })
      expect(done.ok, done.text).toBe(true)
      expect(await prisma.accountingEntry.count({ where: { id: first.id } })).toBe(0)
      const refusals = await prisma.auditLog.findMany({ where: { action: 'MCP_FULL_CONTROL_REFUSED' } })
      expect(refusals.length).toBeGreaterThanOrEqual(4)
      expect(await prisma.auditLog.count({ where: { action: 'MCP_FULL_CONTROL_PENDING' } })).toBe(1)
    })
  })

  describe('automatic mode', () => {
    const automaticKey = (access: CompanyAccess = { allCompanies: true, companyIds: [] }, user = OWNER, name = 'Claude Code') =>
      apiKey('admin', access, user, name, 'automatic')

    it('executes a high-impact tool on the call, without pending action, and audits it as automatic', async () => {
      const key = await automaticKey()
      const entry = await draft('a', '2025-02-01', '606', '401', '10.00')
      const done = await call(key, 'validate_entries', { companyId: ids.aCompany, entryIds: [entry.id] })
      expect(done.ok, done.text).toBe(true)
      expect(done.data).toMatchObject({ executed: true, result: { validated: [{ id: entry.id, number: '1' }] } })
      expect(done.data).not.toHaveProperty('actionId')
      expect(done.data).not.toHaveProperty('approvalUrl')
      expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('validated')
      expect(await prisma.mcpPendingAction.count()).toBe(0)

      const [row] = await auditOf('validate_entries')
      expect(row.message).toContain('mode automatique')
      expect(row.message).toContain('Claude Code')
      expect(row).toMatchObject({ userId: OWNER.email, companyId: ids.aCompany })
      expect(row.metadata).toMatchObject({ tool: 'validate_entries', executionMode: 'automatic', assistant: { kind: 'apiKey', name: 'Claude Code' } })
      expect(await prisma.auditLog.count({ where: { action: 'MCP_FULL_CONTROL_PENDING' } })).toBe(0)
    })

    it('still returns a preview with dryRun: true, writing nothing', async () => {
      const key = await automaticKey()
      const entry = await draft('a', '2025-02-01', '606', '401', '10.00')
      const dry = await call(key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: entry.id, dryRun: true })
      expect(dry.ok, dry.text).toBe(true)
      expect(dry.data).toMatchObject({ dryRun: true, preview: { entryToDelete: { id: entry.id } } })
      expect(dry.data).not.toHaveProperty('actionId')
      expect(await prisma.accountingEntry.count({ where: { id: entry.id } })).toBe(1)
      expect(await auditOf('delete_draft_entry')).toHaveLength(0)
      // An actionId of the validation flow means nothing here: the call executes.
      const done = await call(key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: entry.id, actionId: 'act_forged' })
      expect(done.ok, done.text).toBe(true)
      expect(await prisma.accountingEntry.count({ where: { id: entry.id } })).toBe(0)
    })

    it('keeps the grant, the role, the rate limit and the accounting invariants', async () => {
      const onlyA = await automaticKey({ allCompanies: false, companyIds: [ids.aCompany] })
      const entryOfB = await draft('b', '2025-02-01', '606', '401', '10.00')
      const outside = await call(onlyA, 'validate_entries', { companyId: ids.bCompany, entryIds: [entryOfB.id] })
      expect(outside.text).toBe('Société introuvable')
      expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: entryOfB.id } })).status).toBe('draft')

      const viewerKey = await automaticKey({ allCompanies: true, companyIds: [] }, VIEWER, 'Viewer')
      const entry = await draft('a', '2025-02-01', '606', '401', '10.00')
      const byViewer = await call(viewerKey, 'validate_entries', { companyId: ids.aCompany, entryIds: [entry.id] })
      expect(byViewer.ok).toBe(false)
      expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('draft')

      // A validated entry stays definitive (PCG art. 1031-3), a year with drafts cannot be closed.
      const key = await automaticKey()
      const { validateEntries } = await import('@/lib/accounting/services/entry-lifecycle.service')
      await validateEntries(ids.aCompany, [entry.id])
      const deleted = await call(key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: entry.id })
      expect(deleted.ok).toBe(false)
      expect(await prisma.accountingEntry.count({ where: { id: entry.id } })).toBe(1)
      await draft('a', '2025-03-01', '606', '401', '5.00')
      const closing = await call(key, 'close_fiscal_year', { companyId: ids.aCompany, fiscalYearId: ids.aFy })
      expect(closing.ok).toBe(false)
      expect((await prisma.fiscalYear.findUniqueOrThrow({ where: { id: ids.aFy } })).isClosed).toBe(false)

      await prisma.rateLimit.updateMany({ where: { key: `mcp-full-control|${OWNER.id}` }, data: { count: 60, lastRequest: BigInt(Date.now()) } })
      const limited = await call(key, 'run_rules', { companyId: ids.aCompany })
      expect(limited.text).toContain('Trop')
    })

    it('applies a change of mode to the next call', async () => {
      const { setGrant } = await import('@/lib/ai-access/manage-grants.service')
      const created = await createApiKeyWithGrant({ ...OWNER }, 'Bascule', { allCompanies: true, companyIds: [] }, 'admin')
      expect(created.executionMode).toBe('automatic') // default
      const target = { kind: 'apiKey' as const, apiKeyId: created.id }
      const first = await draft('a', '2025-02-01', '606', '401', '10.00')
      const second = await draft('a', '2025-02-02', '606', '401', '20.00')

      await setGrant({ ...OWNER }, target, { allCompanies: true, companyIds: [] }, 'validation')
      const pending = await call(created.key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: first.id })
      expect(pending.data).toMatchObject({ dryRun: true, actionId: expect.stringMatching(/^act_/) })
      expect(await prisma.accountingEntry.count({ where: { id: first.id } })).toBe(1)

      // Changing the companies alone keeps the mode.
      await setGrant({ ...OWNER }, target, { allCompanies: false, companyIds: [ids.aCompany] })
      expect((await call(created.key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: first.id })).data.dryRun).toBe(true)

      await setGrant({ ...OWNER }, target, { allCompanies: true, companyIds: [] }, 'automatic')
      const done = await call(created.key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: second.id })
      expect(done.data.executed).toBe(true)
      expect(await prisma.accountingEntry.count({ where: { id: second.id } })).toBe(0)
    })

    it('runs an OAuth assistant by the mode of its grant', async () => {
      await prisma.oauthClient.create({ data: { id: 'oc-auto', clientId: 'client-auto', name: 'Claude', redirectUris: ['https://claude.ai/cb'] } })
      await prisma.aiAccessGrant.create({ data: { userId: OWNER.id, clientId: 'client-auto', allCompanies: true } })
      const { getExecutionMode } = await import('@/lib/ai-access/manage-grants.service')
      // A new grant is automatic (column default), a missing one reads as validation (fail closed).
      expect(await getExecutionMode(OWNER.id, { kind: 'oauth', clientId: 'client-auto' })).toBe('automatic')
      expect(await getExecutionMode(OWNER.id, { kind: 'oauth', clientId: 'unknown' })).toBe('validation')
      await prisma.oauthConsent.create({
        data: { id: 'consent-auto', userId: OWNER.id, clientId: 'client-auto', scopes: ['kledg:read', 'kledg:write', 'kledg:admin'] },
      })
      const handlers = new Map<string, (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>>()
      registerKledgTools(
        { registerTool: (name: string, _config: unknown, handler: never) => handlers.set(name, handler) } as never,
        { user: { ...OWNER }, canWrite: true, canAdmin: true, caller: { kind: 'oauth', clientId: 'client-auto' }, executionMode: 'automatic' },
      )
      const rule = await prisma.transactionRule.create({ data: { companyId: ids.aCompany, name: 'Règle' } })
      const result = await handlers.get('delete_rule')!({ companyId: ids.aCompany, ruleId: rule.id })
      expect(result.isError, result.content[0]?.text).toBeFalsy()
      expect(await prisma.transactionRule.count({ where: { id: rule.id } })).toBe(0)
      const [row] = await auditOf('delete_rule')
      expect(row.metadata).toMatchObject({ executionMode: 'automatic', assistant: { kind: 'oauth', name: 'Claude' } })
    })
  })

  describe('audit log', () => {
    it('names the user, the assistant, the tool and the ids of each action', async () => {
      const key = await apiKey('admin', { allCompanies: true, companyIds: [] }, OWNER, 'Claude Code')
      const entry = await draft('a', '2025-02-01', '606', '401', '10.00')
      await confirmed(key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: entry.id })
      const [row] = await auditOf('delete_draft_entry')
      expect(row).toMatchObject({ userId: OWNER.email, companyId: ids.aCompany, level: 'INFO' })
      expect(row.metadata).toMatchObject({
        source: 'mcp',
        tool: 'delete_draft_entry',
        userId: OWNER.id,
        assistant: { kind: 'apiKey', name: 'Claude Code' },
        entryId: entry.id,
      })
    })

    it('names the OAuth client of an assistant', async () => {
      await prisma.oauthClient.create({ data: { id: 'oc-claude', clientId: 'client-claude', name: 'Claude', redirectUris: ['https://claude.ai/cb'] } })
      await prisma.oauthConsent.create({
        data: { id: 'consent-owner-claude', userId: OWNER.id, clientId: 'client-claude', scopes: ['kledg:read', 'kledg:write', 'kledg:admin'] },
      })
      // The consent page saves the grant with the consent (no grant: no company).
      await prisma.aiAccessGrant.create({ data: { userId: OWNER.id, clientId: 'client-claude', allCompanies: true } })
      const handlers = new Map<string, (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>>()
      registerKledgTools(
        { registerTool: (name: string, _config: unknown, handler: never) => handlers.set(name, handler) } as never,
        { user: { ...OWNER }, canWrite: true, canAdmin: true, caller: { kind: 'oauth', clientId: 'client-claude' }, executionMode: 'validation' },
      )
      const result = await handlers.get('create_journal')!({ companyId: ids.aCompany, code: 'BQ2', label: 'Banque 2' })
      expect(result.isError).toBeFalsy()
      const [row] = await auditOf('create_journal')
      expect(row.metadata).toMatchObject({ assistant: { kind: 'oauth', id: 'client-claude', name: 'Claude' }, code: 'BQ2' })
    })
  })

  describe('rate limit', () => {
    it('limits full control calls per user and minute', async () => {
      const key = await apiKey('admin')
      await prisma.rateLimit.create({
        data: { id: 'rl-owner', key: `mcp-full-control|${OWNER.id}`, count: 60, lastRequest: BigInt(Date.now()) },
      })
      const limited = await call(key, 'list_rules', { companyId: ids.aCompany })
      expect(limited.ok).toBe(false)
      expect(limited.text).toContain('Trop')
      // Read and draft tools are not concerned
      expect((await call(key, 'list_journals', { companyId: ids.aCompany })).ok).toBe(true)
    })
  })

  describe('tools', () => {
    it('edits a draft and refuses a validated entry, deletes drafts only', async () => {
      const key = await apiKey('admin')
      const entry = await draft('a', '2025-02-01', '606', '401', '10.00')
      const updated = await call(key, 'update_draft_entry', {
        companyId: ids.aCompany,
        entryId: entry.id,
        description: 'Fournitures',
        lines: [
          { accountCode: '606100', debit: 12.5 },
          { accountCode: '401', credit: '12.50' },
        ],
      })
      expect(updated.ok, updated.text).toBe(true)
      expect(updated.data).toMatchObject({ status: 'draft', description: 'Fournitures', totalDebit: 12.5, balanced: true })

      const unbalanced = await call(key, 'update_draft_entry', {
        companyId: ids.aCompany,
        entryId: entry.id,
        lines: [
          { accountCode: '606100', debit: 10 },
          { accountCode: '401', credit: 9 },
        ],
      })
      expect(unbalanced.ok).toBe(false)

      const { validateEntries } = await import('@/lib/accounting/services/entry-lifecycle.service')
      await validateEntries(ids.aCompany, [entry.id])
      const immutable = await call(key, 'update_draft_entry', { companyId: ids.aCompany, entryId: entry.id, description: 'x' })
      expect(immutable.text).toContain('PCG art. 1031-3')

      const dry = await call(key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: entry.id })
      expect(dry.data.preview.warnings[0]).toContain('validée')
      await approve(dry.data.actionId)
      const refused = await call(key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: entry.id, actionId: dry.data.actionId })
      expect(refused.ok).toBe(false)
      expect(await prisma.accountingEntry.count({ where: { id: entry.id } })).toBe(1)
    })

    it('reverses a validated entry with a preview of the swapped lines', async () => {
      const key = await apiKey('admin')
      const entry = await draft('a', '2025-02-01', '606', '401', '10.00')
      const { validateEntries } = await import('@/lib/accounting/services/entry-lifecycle.service')
      await validateEntries(ids.aCompany, [entry.id])
      const { preview, result } = await confirmed(key, 'reverse_entry', { companyId: ids.aCompany, entryId: entry.id, date: '2025-02-10' })
      expect(preview.reversal.lines).toEqual([
        expect.objectContaining({ account: '606', debit: 0, credit: 10 }),
        expect.objectContaining({ account: '401', debit: 10, credit: 0 }),
      ])
      expect(result).toMatchObject({ reversedEntryId: entry.id, number: '2', date: '2025-02-10' })
      const again = await call(key, 'reverse_entry', { companyId: ids.aCompany, entryId: entry.id })
      expect(again.data.preview.warnings[0]).toContain('Déjà contre-passée')
    })

    it('manages assignment rules', async () => {
      const key = await apiKey('admin')
      const rule = {
        name: 'Frais bancaires',
        conditions: [{ conditionType: 'label', operator: 'contains', value: 'FRAIS' }],
        entryLines: [{ accountCode: '627', lineType: 'auto', amountType: 'full' }],
      }
      const created = await call(key, 'create_rule', { companyId: ids.aCompany, ...rule })
      expect(created.ok, created.text).toBe(true)
      const ruleId = created.data.id
      const updated = await call(key, 'update_rule', { companyId: ids.aCompany, ruleId, ...rule, name: 'Frais', priority: 5 })
      expect(updated.data).toMatchObject({ name: 'Frais', priority: 5, conditions: [{ conditionType: 'label', value: 'FRAIS' }] })
      expect((await call(key, 'list_rules', { companyId: ids.aCompany })).data).toHaveLength(1)
      const ofB = await call(key, 'update_rule', { companyId: ids.bCompany, ruleId, ...rule })
      expect(ofB.text).toBe('Règle introuvable')
      const { preview } = await confirmed(key, 'delete_rule', { companyId: ids.aCompany, ruleId })
      expect(preview.ruleToDelete.name).toBe('Frais')
      expect(await prisma.transactionRule.count()).toBe(0)
    })

    it('creates accounts and journals through the same checks as the web app', async () => {
      const key = await apiKey('admin')
      const account = await call(key, 'create_account', { companyId: ids.aCompany, code: '6061', label: 'Eau et énergie' })
      expect(account.ok, account.text).toBe(true)
      const parent = await prisma.account.findUniqueOrThrow({ where: { id: account.data.id }, select: { parent: { select: { code: true } } } })
      expect(parent.parent?.code).toBe('606')
      const duplicate = await call(key, 'create_account', { companyId: ids.aCompany, code: '6061', label: 'Eau' })
      expect(duplicate.text).toContain('existe déjà')
      const wrongParent = await call(key, 'create_account', { companyId: ids.aCompany, code: '6062', label: 'X', parentCode: '401' })
      expect(wrongParent.text).toContain('doit commencer par le code du parent')

      expect((await call(key, 'create_journal', { companyId: ids.aCompany, code: 'bq2', label: 'Banque 2' })).data.code).toBe('BQ2')
      expect((await call(key, 'create_journal', { companyId: ids.aCompany, code: 'BQ2', label: 'Banque 2' })).text).toContain('existe déjà')
    })

    it('refuses to sync a manual bank account and lists bank accounts', async () => {
      const key = await apiKey('admin')
      const created = await call(key, 'create_bank_account', { companyId: ids.aCompany, name: 'Compte courant', ledgerAccountCode: '512000' })
      expect(created.ok, created.text).toBe(true)
      const [connection] = (await call(key, 'list_bank_accounts', { companyId: ids.aCompany })).data as unknown as Array<{
        connectionId: string
        provider: string
        accounts: Array<{ id: string }>
      }>
      expect(connection).toMatchObject({ provider: 'MANUAL', accounts: [{ id: created.data.id }] })
      const sync = await call(key, 'sync_bank', { companyId: ids.aCompany, connectionId: connection.connectionId })
      expect(sync.ok).toBe(false)
      expect(sync.text).toContain("n'est relié à aucune banque")
    })

    it('undoes a reconciliation after a preview of its effect', async () => {
      const key = await apiKey('admin')
      const account = await call(key, 'create_bank_account', { companyId: ids.aCompany, name: 'Compte', ledgerAccountCode: '512000' })
      const transaction = await prisma.bankTransaction.create({
        data: { bankAccountId: account.data.id, externalTransactionId: 'tx-1', amount: '50.00', side: 'debit', date: day('2025-04-01'), label: 'Achat' },
      })
      const reconcile = (args: Record<string, unknown>) => call(key, 'reconcile_transaction', { companyId: ids.aCompany, transactionId: transaction.id, ...args })
      const lines = [{ accountCode: '606100', debit: 50 }]
      const done = await reconcile({ lines })
      expect(done.ok, done.text).toBe(true)
      expect(done.data).toMatchObject({ reconciled: true, entryStatus: 'draft' })
      expect((await reconcile({ lines })).text).toContain('déjà rapprochée')
      expect(await prisma.accountingEntry.count({ where: { sourceBankTransactionId: transaction.id } })).toBe(1)

      const { preview, result } = await confirmed(key, 'unreconcile_transaction', { companyId: ids.aCompany, transactionId: transaction.id })
      expect(preview).toMatchObject({ effect: 'delete_draft_entry', entry: { id: done.data.entryId, status: 'draft' }, warnings: [] })
      expect(result).toMatchObject({ deletedEntryId: done.data.entryId })
      expect(await prisma.accountingEntry.count({ where: { id: done.data.entryId } })).toBe(0)
    })
  })

  it('runs a year end to end: statement, rules, reconciliation, validation, depreciation, closing, allocation, FEC', async () => {
    const key = await apiKey('admin', { allCompanies: true, companyIds: [] }, OWNER, 'Claude')
    const companyId = ids.aCompany

    // Bank account fed by statements
    const account = await call(key, 'create_bank_account', { companyId, name: 'Compte courant', ledgerAccountCode: '512000' })
    const bankAccountId = account.data.id

    // Statement: dry run shows the analysis, confirmation imports, a second import creates nothing
    const statement = { companyId, bankAccountId, fileName: 'releve-2025-03.csv', contentBase64: base64(STATEMENT) }
    const imported = await confirmed(key, 'import_statement', statement)
    expect(imported.preview.summary).toMatchObject({ total: 3, new: 3, duplicates: 0, from: '2025-03-15', to: '2025-03-25' })
    expect(imported.result.created).toBe(3)
    const reimport = await confirmed(key, 'import_statement', statement)
    expect(reimport.preview.summary).toMatchObject({ new: 0, duplicates: 3 })
    expect(reimport.result.created).toBe(0)
    expect(await prisma.bankTransaction.count({ where: { bankAccountId } })).toBe(3)

    // Assignment rule (every condition must match), then the engine
    const rule = await call(key, 'create_rule', {
      companyId,
      name: 'Fournitures Martin',
      conditions: [
        { conditionType: 'label', operator: 'contains', value: 'FOURNITURES' },
        { conditionType: 'label', operator: 'contains', value: 'MARTIN' },
        { conditionType: 'side', operator: 'equals', value: 'debit' },
      ],
      entryLines: [{ accountCode: '606100', lineType: 'auto', amountType: 'full' }],
    })
    expect(rule.ok, rule.text).toBe(true)
    const rules = await confirmed(key, 'run_rules', { companyId })
    expect(rules.preview).toMatchObject({ processed: 3, matched: 1, wouldApply: 1 })
    expect(rules.result).toMatchObject({ applied: 1, errors: [] })
    const rerun = await confirmed(key, 'run_rules', { companyId })
    expect(rerun.result).toMatchObject({ processed: 2, applied: 0 })

    // Manual reconciliation of the customer payment and of the bank fees
    const transactions = await prisma.bankTransaction.findMany({ where: { bankAccountId, reconciled: false }, orderBy: { date: 'asc' } })
    const [dupont, fees] = transactions
    const reconciled = await call(key, 'reconcile_transaction', { companyId, transactionId: dupont.id, lines: [{ accountCode: '706000', credit: 1200 }] })
    expect(reconciled.ok, reconciled.text).toBe(true)
    expect((await call(key, 'reconcile_transaction', { companyId, transactionId: fees.id, lines: [{ accountCode: '627', debit: '10.00' }] })).ok).toBe(true)

    // Validate every draft
    const drafts = await call(key, 'list_entries', { companyId, status: 'draft', limit: 50 })
    const draftIds = (drafts.data as unknown as Array<{ id: string }>).map((e) => e.id)
    expect(draftIds).toHaveLength(3)
    const validation = await confirmed(key, 'validate_entries', { companyId, entryIds: draftIds })
    expect(validation.preview.entries.map((e: { numberToAssign: string }) => e.numberToAssign)).toEqual(['1', '2', '3'])
    expect(validation.result.validated.map((e: { number: string }) => e.number)).toEqual(['1', '2', '3'])

    // Fixed asset and its depreciation for 2025: 3 000 over 3 years
    const asset = await call(key, 'create_fixed_asset', {
      companyId,
      label: 'Ordinateur',
      acquisitionDate: '2025-01-01',
      acquisitionValue: 3000,
      depreciationMethod: 'linear',
      depreciationDuration: 3,
      assetAccountCode: '2183',
      depreciationAccountCode: '28183',
      expenseAccountCode: '6811',
    })
    expect(asset.ok, asset.text).toBe(true)
    const fiscalYearId = ids.aFy
    const depreciation = await confirmed(key, 'generate_depreciation', { companyId, fiscalYearId })
    expect(depreciation.preview).toMatchObject({ count: 1, total: 1000, entryDate: '2025-12-31' })
    expect(depreciation.result).toMatchObject({ count: 1, total: 1000 })
    expect((await confirmed(key, 'generate_depreciation', { companyId, fiscalYearId })).result.count).toBe(0)

    // Closing: result 1 200 - 120 - 10 - 1 000 = 70
    const closing = await confirmed(key, 'close_fiscal_year', { companyId, fiscalYearId })
    expect(closing.preview).toMatchObject({ canClose: true, errors: [] })
    expect(closing.preview.simulation.closingEntries.result.amount).toBe(70)
    expect(closing.result).toMatchObject({ closed: true, result: 70 })
    const closedAgain = await call(key, 'close_fiscal_year', { companyId, fiscalYearId })
    expect(closedAgain.data.preview.canClose).toBe(false)

    // Allocation of the 2025 result in 2026: 5 % legal reserve (SAS), the rest to retained earnings
    const nextFiscalYearId = closing.result.nextFiscalYearId
    const allocation = await confirmed(key, 'allocate_result', { companyId, fiscalYearId: nextFiscalYearId, date: '2026-06-15' })
    expect(allocation.preview.balances.result).toBe(70)
    expect(allocation.preview.plan.errors).toEqual([])
    expect(allocation.result.plan.result).toBe(70)
    expect(allocation.result.entryId).toBeTruthy()
    const againArgs = { companyId, fiscalYearId: nextFiscalYearId, date: '2026-06-15' }
    const againDry = await call(key, 'allocate_result', againArgs)
    expect(againDry.data.preview.plan.errors.length).toBeGreaterThan(0)
    await approve(againDry.data.actionId)
    const allocatedAgain = await call(key, 'allocate_result', { ...againArgs, actionId: againDry.data.actionId })
    expect(allocatedAgain.ok).toBe(false)
    expect(await prisma.accountingEntry.count({ where: { companyId, reference: 'AFF-2025' } })).toBe(1)

    // FEC of the closed year, valid
    const fec = await call(key, 'export_fec', { companyId, fiscalYearId })
    expect(fec.ok, fec.text).toBe(true)
    expect(fec.data.fileName).toBe('123456782FEC20251231.txt')
    expect(fec.data.report.errors).toEqual([])
    expect(fec.data.report.valid).toBe(true)
    expect(fec.data.content.split('\r\n')[0]).toContain('JournalCode')

    // Every action is in the audit log, named after the key; dry runs are not
    const audited = await prisma.auditLog.findMany({ where: { action: 'MCP_FULL_CONTROL', companyId } })
    const tools = audited.map((r) => (r.metadata as { tool: string }).tool)
    for (const tool of ['create_bank_account', 'import_statement', 'create_rule', 'run_rules', 'reconcile_transaction', 'validate_entries', 'create_fixed_asset', 'generate_depreciation', 'close_fiscal_year', 'allocate_result', 'export_fec']) {
      expect(tools, tool).toContain(tool)
    }
    expect(tools.filter((t) => t === 'import_statement')).toHaveLength(2)
    for (const row of audited) expect((row.metadata as { assistant: { name: string } }).assistant.name).toBe('Claude')
  }, 120_000)
})
