/**
 * MCP authorization: tools x access level x company grant, through the real
 * /api/mcp handler with API keys (session mocked; Better Auth, services,
 * triggers real). Complements lib/mcp/__tests__/full-control.db.test.ts, which
 * covers the end-to-end accounting flow; this file concentrates on the access
 * boundary an attacker probes:
 * - a tool is only registered for its level (read < write < admin);
 * - a company id outside the connection's grant is refused (NotFoundError),
 *   exactly like a company the user is not a member of;
 * - list_companies never leaks a company outside the grant;
 * - the user role still caps a full-control admin key.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('security_mcp')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { AccessLevel, CompanyAccess, ExecutionMode } from '@/lib/ai-access/access'
import { apiKeyLevelOf } from '@/lib/ai-access/access'
import { NEW_FINDINGS, DELEGATED_FINDINGS, skip } from './findings'

const available = await testDatabaseAvailable()

type Handler = (request: Request) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
let mcp: Record<'POST', Handler>
let createApiKeyWithGrant: typeof import('@/lib/ai-access/create-api-key.service').createApiKeyWithGrant

const OWNER = { id: 'u-owner', email: 'owner@sec.local', name: 'Owner', role: 'user' }
const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seedCompany(prefix: 'a' | 'b' | 'c', siren: string, members: Array<[string, string]>) {
  const company = await prisma.company.create({
    data: { name: `Societe ${prefix}`, slug: `societe-${prefix}`, siren, closingDay: 31, closingMonth: 12 },
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
  for (const [code, label] of [['512000', 'Banque'], ['706000', 'Ventes']]) {
    await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: code!, label: label!, isPCG: true } })
  }
  await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Operations diverses' } })
  await prisma.accountingEntry.create({
    data: { companyId: company.id, fiscalYearId: fy.id, journalId: (await prisma.journal.findFirstOrThrow({ where: { companyId: company.id } })).id, entryNumber: '1', date: day('2025-03-01'), description: 'Seed', status: 'draft' },
  })
  ids[`${prefix}Company`] = company.id
  ids[`${prefix}Fy`] = fy.id
}

async function seed() {
  await prepareTestDatabase('security_mcp')
  await prisma.user.create({ data: { id: OWNER.id, email: OWNER.email, name: OWNER.name, role: OWNER.role } })
  // Owner is companyAdmin on A and B, and has NO membership on C.
  await seedCompany('a', '123456782', [[OWNER.id, 'companyAdmin']])
  await seedCompany('b', '222222229', [[OWNER.id, 'companyAdmin']])
  await seedCompany('c', '333333336', [])
}

async function apiKey(level: AccessLevel, access: CompanyAccess, mode: ExecutionMode = 'automatic'): Promise<string> {
  return (await createApiKeyWithGrant({ ...OWNER }, `k-${level}-${Math.random()}`, access, level, mode)).key
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

async function call(key: string, name: string, args: Record<string, unknown>) {
  const body = await rpc(key, 'tools/call', { name, arguments: args })
  const text = body.result?.content?.[0]?.text ?? body.error?.message ?? ''
  return { ok: !body.result?.isError && !body.error, text }
}

const ONLY_A = (): CompanyAccess => ({ allCompanies: false, companyIds: [ids.aCompany] })
const ALL = (): CompanyAccess => ({ allCompanies: true, companyIds: [] })

describe.skipIf(!available)('MCP authorization boundary', () => {
  beforeAll(async () => {
    await prepareTestDatabase('security_mcp')
    ;({ prisma } = await import('@/lib/prisma'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as Record<'POST', Handler>
    ;({ createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service'))
    await seed()
    state.user = { ...OWNER }
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('registers tools by level only (read < write < admin)', async () => {
    const read = await toolNames(await apiKey('read', ONLY_A()))
    expect(read).toContain('list_entries')
    expect(read).not.toContain('create_draft_entry') // write
    expect(read).not.toContain('create_journal') // full control

    const write = await toolNames(await apiKey('write', ONLY_A()))
    expect(write).toContain('create_draft_entry')
    expect(write).not.toContain('create_journal')

    const admin = await toolNames(await apiKey('admin', ONLY_A()))
    expect(admin).toContain('create_journal')
    expect(admin).toContain('close_fiscal_year')
  })

  it('read tool refuses a company id outside the grant (like a non-member)', async () => {
    const key = await apiKey('read', ONLY_A())
    expect((await call(key, 'list_entries', { companyId: ids.aCompany })).ok).toBe(true)

    const b = await call(key, 'list_entries', { companyId: ids.bCompany })
    expect(b.ok).toBe(false)
    expect(b.text).toMatch(/introuvable|not found|trouv/i)

    const c = await call(key, 'list_entries', { companyId: ids.cCompany })
    expect(c.ok).toBe(false)
  })

  it('list_companies returns only the granted company', async () => {
    const key = await apiKey('read', ONLY_A())
    const body = await rpc(key, 'tools/call', { name: 'list_companies', arguments: {} })
    const text = body.result?.content?.[0]?.text ?? ''
    expect(text).toContain(ids.aCompany)
    expect(text).not.toContain(ids.bCompany)
    expect(text).not.toContain(ids.cCompany)
  })

  it('write tool refuses a draft entry on a company outside the grant', async () => {
    const key = await apiKey('write', ONLY_A())
    const onA = await call(key, 'create_draft_entry', {
      companyId: ids.aCompany, journalCode: 'OD', date: '2025-03-10', description: 'ok',
      lines: [{ accountCode: '512000', debit: 100, credit: 0 }, { accountCode: '706000', debit: 0, credit: 100 }],
    })
    expect(onA.ok, onA.text).toBe(true)

    const onB = await call(key, 'create_draft_entry', {
      companyId: ids.bCompany, journalCode: 'OD', date: '2025-03-10', description: 'evil',
      lines: [{ accountCode: '512000', debit: 100, credit: 0 }, { accountCode: '706000', debit: 0, credit: 100 }],
    })
    expect(onB.ok).toBe(false)
    expect(await prisma.accountingEntry.count({ where: { companyId: ids.bCompany, description: 'evil' } })).toBe(0)
  })

  it('full-control admin key refuses a company outside the grant', async () => {
    const key = await apiKey('admin', ONLY_A())
    const onB = await call(key, 'create_journal', { companyId: ids.bCompany, code: 'ZZ', label: 'Intrus' })
    expect(onB.ok).toBe(false)
    expect(await prisma.journal.count({ where: { companyId: ids.bCompany, code: 'ZZ' } })).toBe(0)
  })

  it('the user role still caps an all-companies admin key (no membership on C)', async () => {
    const key = await apiKey('admin', ALL())
    const onC = await call(key, 'create_journal', { companyId: ids.cCompany, code: 'ZZ', label: 'Intrus' })
    expect(onC.ok).toBe(false)
    expect(await prisma.journal.count({ where: { companyId: ids.cCompany, code: 'ZZ' } })).toBe(0)
  })

  it('management fees never reach a subsidiary outside the grant (inCompany narrows, never widens)', async () => {
    // A is the holding of B (B records A as shareholder); the owner is a member of both.
    await prisma.shareholder.create({ data: { companyId: ids.bCompany, type: 'LEGAL', sharePercentage: 100, companyShareholderId: ids.aCompany } })
    const convention = await prisma.managementFeeConvention.create({
      data: {
        companyId: ids.aCompany,
        label: 'Animation',
        pricing: 'FIXED',
        markupBp: 0,
        fixedAmount: 1000,
        allocationKey: 'EQUAL',
        costAccountPrefixes: ['6'],
        excludedAccountPrefixes: [],
        startDate: day('2025-01-01'),
        subsidiaries: { create: [{ subsidiaryId: ids.bCompany, position: 0 }] },
      },
    })
    const args = { companyId: ids.aCompany, conventionId: convention.id, periodStart: '2025-01-01', periodEnd: '2025-03-31' }

    const onlyA = await apiKey('read', ONLY_A())
    const preview = await call(onlyA, 'preview_management_fees', args)
    expect(preview.ok).toBe(false)
    expect(preview.text).toContain('n’est pas accessible')
    const listed = await call(onlyA, 'list_management_fee_conventions', { companyId: ids.aCompany })
    expect(listed.ok, listed.text).toBe(true)
    expect(JSON.parse(listed.text).conventions[0].subsidiaries).toEqual([expect.objectContaining({ id: ids.bCompany, name: null, accessible: false })])
    expect(listed.text).not.toContain('Societe b')

    const all = await apiKey('read', ALL())
    const granted = await call(all, 'preview_management_fees', args)
    expect(granted.ok, granted.text).toBe(true)
    expect(JSON.parse(granted.text).subsidiaries).toEqual([expect.objectContaining({ id: ids.bCompany, name: 'Societe b', amountExclTax: 1000 })])
  })

  it('the group view never reads nor names a subsidiary outside the grant (get_group_view, get_participations)', async () => {
    // A is the holding of B (the owner is a member of both) and of C (the owner is not a member).
    if ((await prisma.shareholder.count({ where: { companyId: ids.bCompany, companyShareholderId: ids.aCompany } })) === 0) {
      await prisma.shareholder.create({ data: { companyId: ids.bCompany, type: 'LEGAL', sharePercentage: 100, companyShareholderId: ids.aCompany } })
    }
    await prisma.shareholder.create({ data: { companyId: ids.cCompany, type: 'LEGAL', sharePercentage: 30, companyShareholderId: ids.aCompany } })
    const args = { companyId: ids.aCompany, fiscalYearId: ids.aFy }
    const secretsOf = (...prefixes: Array<'b' | 'c'>) =>
      prefixes.flatMap((p) => [ids[`${p}Company`], `Societe ${p}`, p === 'b' ? '222222229' : '333333336'])

    const onlyA = await apiKey('read', ONLY_A())
    const view = await call(onlyA, 'get_group_view', args)
    expect(view.ok, view.text).toBe(true)
    const data = JSON.parse(view.text)
    expect(data.companies.map((c: { id: string }) => c.id)).toEqual([ids.aCompany])
    expect(data.notAccessibleSubsidiaries).toBe(2)
    expect(data.notAccessibleNames).toEqual([])
    for (const secret of secretsOf('b', 'c')) expect(view.text).not.toContain(secret)
    const participations = await call(onlyA, 'get_participations', args)
    expect(participations.ok, participations.text).toBe(true)
    expect(JSON.parse(participations.text)).toMatchObject({ participations: [], notAccessibleSubsidiaries: 2 })
    for (const secret of secretsOf('b', 'c')) expect(participations.text).not.toContain(secret)
    // The holding itself must be in the grant.
    expect((await call(onlyA, 'get_group_view', { companyId: ids.bCompany })).ok).toBe(false)

    // Granted every company: B is read; C stays out of reach (the owner is not a member), unnamed.
    const all = await apiKey('read', ALL())
    const granted = await call(all, 'get_group_view', args)
    expect(granted.ok, granted.text).toBe(true)
    const grantedData = JSON.parse(granted.text)
    expect(grantedData.companies.map((c: { name: string }) => c.name)).toEqual(['Societe a', 'Societe b'])
    expect(grantedData.companies[1]).toMatchObject({ role: 'subsidiary', ownershipPercent: 100 })
    expect(grantedData.notAccessibleSubsidiaries).toBe(1)
    for (const secret of secretsOf('c')) expect(granted.text).not.toContain(secret)
  })

  it('an api key with no explicit kledg level is read-only (KLEDG-SEC-008, fixed)', () => {
    expect(apiKeyLevelOf({})).toBe('read')
    expect(apiKeyLevelOf(null)).toBe('read')
    expect(apiKeyLevelOf({ kledg: ['read'] })).toBe('read')
    expect(apiKeyLevelOf({ kledg: ['read', 'write'] })).toBe('write')
  })

  it('a connection whose grant row is missing reaches no company (KLEDG-SEC-007, fixed)', async () => {
    const created = await createApiKeyWithGrant({ ...OWNER }, 'no-grant', ONLY_A(), 'read')
    await prisma.aiAccessGrant.deleteMany({ where: { apiKeyId: created.id } })
    for (const companyId of [ids.aCompany, ids.bCompany]) {
      const result = await call(created.key, 'list_entries', { companyId })
      expect(result.ok).toBe(false)
    }
  })

  it('in validation mode, a destructive full-control tool cannot be confirmed by the agent itself (KLEDG-DEL-mcp-self-confirm, fixed)', async () => {
    const key = await apiKey('admin', ALL(), 'validation')
    const args = { companyId: ids.aCompany, fiscalYearId: ids.aFy }
    const dry = await call(key, 'close_fiscal_year', args)
    expect(dry.ok, dry.text).toBe(true)
    const preview = JSON.parse(dry.text) as Record<string, unknown>
    expect(preview).not.toHaveProperty('confirmationToken')
    expect(preview.approvalUrl).toEqual(expect.stringContaining('/settings/ai-actions?action='))
    // The agent replays what it received: refused until a human approves in Kledg.
    const replay = await call(key, 'close_fiscal_year', { ...args, actionId: preview.actionId })
    expect(replay.ok).toBe(false)
    const forged = await call(key, 'close_fiscal_year', { ...args, confirm: true, confirmationToken: 'kc_anything' })
    expect(JSON.parse(forged.text)).toMatchObject({ dryRun: true })
    // Asking for automatic execution in the arguments changes nothing: the mode is the grant's, set by the user in Kledg.
    const smuggled = await call(key, 'close_fiscal_year', { ...args, dryRun: false, executionMode: 'automatic' })
    expect(JSON.parse(smuggled.text)).toMatchObject({ dryRun: true })
    expect((await prisma.fiscalYear.findUniqueOrThrow({ where: { id: ids.aFy } })).isClosed).toBe(false)
  })

  it('in automatic mode, a high-impact tool executes on the call (KLEDG-DEL-mcp-self-confirm, accepted risk 2026-10-04)', async () => {
    // Documents the owner decision: with automatic execution, nothing stands
    // between a (possibly prompt-injected) assistant and a high-impact action
    // but the scope, the grant, the role, the rate limit, the audit log and
    // the accounting invariants. What it must still never do is cross those.
    expect(DELEGATED_FINDINGS['KLEDG-DEL-mcp-self-confirm'].note).toContain('accepted risk in automatic mode')
    const key = await apiKey('admin', ONLY_A(), 'automatic')
    const entry = await prisma.accountingEntry.findFirstOrThrow({ where: { companyId: ids.aCompany, description: 'Seed' } })
    const deleted = await call(key, 'delete_draft_entry', { companyId: ids.aCompany, entryId: entry.id })
    expect(deleted.ok, deleted.text).toBe(true)
    expect(JSON.parse(deleted.text)).toMatchObject({ executed: true })
    expect(await prisma.mcpPendingAction.count({ where: { tool: 'delete_draft_entry' } })).toBe(0)
    const audit = await prisma.auditLog.findMany({ where: { action: 'MCP_FULL_CONTROL' } })
    const row = audit.find((r) => (r.metadata as { tool?: string }).tool === 'delete_draft_entry')
    expect(row?.message).toContain('mode automatique')
    expect(row?.metadata).toMatchObject({ executionMode: 'automatic' })
    // Still bounded: another company is out of reach, even in automatic mode.
    const entryOfB = await prisma.accountingEntry.findFirstOrThrow({ where: { companyId: ids.bCompany } })
    const onB = await call(key, 'delete_draft_entry', { companyId: ids.bCompany, entryId: entryOfB.id })
    expect(onB.ok).toBe(false)
    expect(await prisma.accountingEntry.count({ where: { id: entryOfB.id } })).toBe(1)
  })
})
