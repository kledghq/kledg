/**
 * The receipt tools (capture_receipt, stage_receipt, file_receipt,
 * docs/justificatifs-photo.md) against PostgreSQL, through the real
 * /api/mcp handler with API keys (session mocked; Better Auth, services,
 * row level security and audit log real; OpenAI's file host answered by a
 * stubbed fetch):
 * - the tools exist from kledg:write, never with a read key;
 * - stage_receipt takes base64 or a ChatGPT file param (OpenAI file hosts
 *   only), and with the fields finds the transaction; every result carries
 *   the data of the receipt capture view;
 * - file_receipt attach is a dry run plus a pending action on a draft-level
 *   key whatever its mode: nothing is attached before the user approves in
 *   Kledg, the approval is bound to the receipt and the transaction (an
 *   edit after the approval refuses it), executes once, and is audited;
 * - with full control in automatic mode, dryRun previews and the call
 *   attaches;
 * - a viewer stages and turns a receipt into an expense report, never
 *   attaches (banking:reconcile); a company outside the grant is
 *   "Société introuvable".
 *
 * Run with KLEDG_RLS=enforce too (docs/rls.md). Skipped when the test
 * database server is unreachable.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('mcp_receipts')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
// File downloads go through the public-address fetch (node:https); here they reach the stubbed global fetch.
vi.mock('@/lib/integrations/public-https-fetch', () => ({
  publicFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { AccessLevel, CompanyAccess, ExecutionMode } from '@/lib/ai-access/access'

const available = await testDatabaseAvailable()

type Handler = (request: Request) => Promise<Response>

let prisma: typeof import('@/lib/prisma').prisma
let mcp: Record<'POST', Handler>
let createApiKeyWithGrant: typeof import('@/lib/ai-access/create-api-key.service').createApiKeyWithGrant

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }
const VIEWER = { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' }

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const jpeg = (seed: string) => Buffer.concat([JPEG, Buffer.from(seed)])
const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seedCompany(prefix: 'a' | 'b', siren: string, members: Array<[string, string]>) {
  const company = await prisma.company.create({ data: { name: `Société ${prefix.toUpperCase()}`, slug: `societe-${prefix}`, siren } })
  await prisma.organization.create({ data: { id: `org-${prefix}`, name: company.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id } })
  for (const [userId, role] of members) await prisma.member.create({ data: { id: `m-${prefix}-${userId}`, userId, organizationId: `org-${prefix}`, role, createdAt: new Date() } })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL', login: `l-${prefix}` } })
  const account = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `acc-${prefix}`, name: 'Compte courant' } })
  const tx = await prisma.bankTransaction.create({ data: { bankAccountId: account.id, externalTransactionId: `${prefix}-bakery`, amount: 43.5, date: day('2026-10-04'), side: 'debit', label: 'CB BOULANGERIE DU MARCHE' } })
  await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  ids[`${prefix}Company`] = company.id
  ids[`${prefix}Bakery`] = tx.id
}

async function seed() {
  await prepareTestDatabase('mcp_receipts')
  for (const user of [OWNER, VIEWER]) await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  await seedCompany('a', '123456782', [
    [OWNER.id, 'companyAdmin'],
    [VIEWER.id, 'viewer'],
  ])
  await seedCompany('b', '222222222', [[OWNER.id, 'companyAdmin']])
}

async function apiKey(level: AccessLevel, { access = { allCompanies: true, companyIds: [] }, user = OWNER, mode = 'automatic' }: { access?: CompanyAccess; user?: typeof OWNER; mode?: ExecutionMode } = {}) {
  return (await createApiKeyWithGrant({ ...user }, `Clé ${level} ${mode}`, access, level, mode)).key
}

type Content = { type: string; text?: string }
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
  return JSON.parse(raw) as { result?: { tools?: Array<{ name: string; _meta?: Record<string, unknown>; inputSchema?: { properties?: Record<string, unknown> } }>; content?: Content[]; isError?: boolean; structuredContent?: Record<string, unknown> }; error?: { message: string } }
}

interface CallResult {
  ok: boolean
  text: string
  data: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  view: Record<string, any> | undefined // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function call(key: string, name: string, args: Record<string, unknown>): Promise<CallResult> {
  const body = await rpc(key, 'tools/call', { name, arguments: args })
  const text = body.result?.content?.[0]?.text ?? body.error?.message ?? ''
  const ok = !body.result?.isError && !body.error
  return { ok, text, data: ok ? JSON.parse(text) : {}, view: body.result?.structuredContent }
}

async function ok(key: string, name: string, args: Record<string, unknown>) {
  const result = await call(key, name, args)
  expect(result.ok, `${name}: ${result.text}`).toBe(true)
  return result
}

async function approve(actionId: string) {
  const { decideAction } = await import('@/lib/mcp/full-control/pending-actions')
  const row = await prisma.mcpPendingAction.findUniqueOrThrow({ where: { id: actionId } })
  return decideAction(row.userId, actionId, 'approve')
}

const FIELDS = { amount: 43.5, date: '2026-10-03', merchant: 'Boulangerie du Marché' }

describe.skipIf(!available)('MCP receipt tools', () => {
  beforeAll(async () => {
    ;({ prisma } = await import('@/lib/prisma'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as Record<'POST', Handler>
    ;({ createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service'))
  }, 60_000)

  beforeEach(async () => {
    await seed()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.hostname === 'files.oaiusercontent.com') return new Response(new Uint8Array(jpeg('chatgpt')), { status: 200 })
        return new Response('not found', { status: 404 })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('exists from kledg:write, with the capture view and the ChatGPT file params', async () => {
    const names = async (key: string) => ((await rpc(key, 'tools/list')).result?.tools ?? []).map((t) => t.name)
    const read = await names(await apiKey('read'))
    for (const tool of ['capture_receipt', 'stage_receipt', 'file_receipt']) {
      expect(read, tool).not.toContain(tool)
      expect(await names(await apiKey('write')), tool).toContain(tool)
    }
    const stage = (await rpc(await apiKey('write'), 'tools/list')).result!.tools!.find((t) => t.name === 'stage_receipt')!
    expect(stage._meta).toMatchObject({ 'openai/fileParams': ['file'], 'openai/outputTemplate': 'ui://kledg/receipt-capture.v1.html' })
    expect(stage.inputSchema?.properties?.file).toMatchObject({ type: 'object', required: ['download_url', 'file_id'] })
    expect(Object.keys((stage.inputSchema!.properties!.file as { properties: object }).properties).sort()).toEqual(['download_url', 'file_id', 'file_name', 'mime_type'])
  })

  it('opens the capture view prefilled with the fields the assistant read', async () => {
    const result = await ok(await apiKey('write'), 'capture_receipt', { companyId: ids.aCompany, ...FIELDS })
    expect(result.view).toMatchObject({ view: 'receipt-capture', mode: 'capture', executionMode: 'validation', canAttach: true, fields: { amount: 43.5, date: '2026-10-03', merchant: 'Boulangerie du Marché' } })
  })

  it('stages base64 with the fields, then attaches only after the approval in Kledg (draft-level key), once', async () => {
    // A draft-level key in automatic mode still waits for the approval: automatic execution is a full control choice.
    const key = await apiKey('write', { mode: 'automatic' })
    const staged = await ok(key, 'stage_receipt', { companyId: ids.aCompany, contentBase64: jpeg('photo').toString('base64'), fileName: 'IMG_1.jpg', from: 'capture_view', ...FIELDS })
    expect(staged.data).toMatchObject({ action: 'match', outcome: 'matched', duplicate: false, match: { transactionId: ids.aBakery, amount: 43.5 } })
    expect(staged.view).toMatchObject({ view: 'receipt-capture', mode: 'result', outcome: 'matched', candidates: [{ transactionId: ids.aBakery }] })
    const stagedReceiptId = staged.data.stagedReceiptId as string
    expect((await prisma.stagedReceipt.findUniqueOrThrow({ where: { id: stagedReceiptId } })).source).toBe('view')

    const args = { companyId: ids.aCompany, action: 'attach', stagedReceiptId, transactionId: ids.aBakery }
    const dry = await ok(key, 'file_receipt', args)
    expect(dry.data).toMatchObject({ dryRun: true, actionId: expect.stringMatching(/^act_/), preview: { destination: 'kledg', transaction: { transactionId: ids.aBakery } } })
    expect(dry.view).toMatchObject({ mode: 'approval', approval: { actionId: dry.data.actionId, destination: 'kledg' } })
    expect(await prisma.attachment.count({ where: { bankTransactionId: ids.aBakery } })).toBe(0)

    // Not approved yet: refused
    expect((await call(key, 'file_receipt', { ...args, actionId: dry.data.actionId })).text).toContain("attend encore l'accord")
    await approve(dry.data.actionId)
    const done = await ok(key, 'file_receipt', { ...args, actionId: dry.data.actionId })
    expect(done.data).toMatchObject({ executed: true, result: { action: 'attach', destination: 'kledg', receipts: 1 } })
    expect(done.view).toMatchObject({ mode: 'done', done: { kind: 'attached' } })
    expect(await prisma.attachment.count({ where: { bankTransactionId: ids.aBakery } })).toBe(1)
    // Replayed: refused, nothing more
    expect((await call(key, 'file_receipt', { ...args, actionId: dry.data.actionId })).text).toContain('déjà été exécutée')
    const audit = await prisma.auditLog.findMany({ where: { companyId: ids.aCompany, action: { in: ['MCP_FULL_CONTROL_PENDING', 'MCP_FULL_CONTROL', 'RECEIPT_ATTACHED'] } }, select: { action: true } })
    // stage_receipt and the executed attach (MCP_FULL_CONTROL), the pending action, the service's own entry
    expect(audit.map((a) => a.action).sort()).toEqual(['MCP_FULL_CONTROL', 'MCP_FULL_CONTROL', 'MCP_FULL_CONTROL_PENDING', 'RECEIPT_ATTACHED'])
  })

  it('binds the approval to the transaction: an edit after the approval refuses the execution', async () => {
    const key = await apiKey('write')
    const staged = await ok(key, 'stage_receipt', { companyId: ids.aCompany, contentBase64: jpeg('bound').toString('base64'), fileName: 'b.jpg', ...FIELDS })
    const args = { companyId: ids.aCompany, action: 'attach', stagedReceiptId: staged.data.stagedReceiptId, transactionId: ids.aBakery }
    const dry = await ok(key, 'file_receipt', args)
    await approve(dry.data.actionId)
    await prisma.bankTransaction.update({ where: { id: ids.aBakery }, data: { label: 'CB AUTRE COMMERCE' } })
    const refused = await call(key, 'file_receipt', { ...args, actionId: dry.data.actionId })
    expect(refused.ok).toBe(false)
    expect(refused.text).toContain('Les données ont changé depuis l\'approbation')
    expect(await prisma.attachment.count({ where: { bankTransactionId: ids.aBakery } })).toBe(0)
  })

  it('previews with dryRun then attaches at once with full control in automatic mode', async () => {
    const key = await apiKey('admin', { mode: 'automatic' })
    const staged = await ok(key, 'stage_receipt', { companyId: ids.aCompany, contentBase64: jpeg('auto').toString('base64'), fileName: 'a.jpg', ...FIELDS })
    const args = { companyId: ids.aCompany, action: 'attach', stagedReceiptId: staged.data.stagedReceiptId, transactionId: ids.aBakery }
    const preview = await ok(key, 'file_receipt', { ...args, dryRun: true })
    expect(preview.data).toMatchObject({ dryRun: true, preview: { destination: 'kledg' } })
    expect(preview.view).toMatchObject({ mode: 'approval', approval: { actionId: null } })
    expect(await prisma.attachment.count({ where: { bankTransactionId: ids.aBakery } })).toBe(0)
    expect((await ok(key, 'file_receipt', args)).data).toMatchObject({ executed: true, result: { action: 'attach', alreadyAttached: false } })
    // Idempotent on the same file
    expect((await ok(key, 'file_receipt', args)).data).toMatchObject({ executed: true, result: { alreadyAttached: true } })
    expect(await prisma.attachment.count({ where: { bankTransactionId: ids.aBakery } })).toBe(1)
  })

  it('takes a ChatGPT file from the OpenAI file hosts only', async () => {
    const key = await apiKey('write')
    const file = { download_url: 'https://files.oaiusercontent.com/file-1?sig=x', file_id: 'file-1', file_name: 'photo.jpg', mime_type: 'image/jpeg' }
    const staged = await ok(key, 'stage_receipt', { companyId: ids.aCompany, file })
    expect(staged.data).toMatchObject({ action: 'stage', duplicate: false, receipt: { fileName: 'photo.jpg', contentType: 'image/jpeg', status: 'staged' } })
    expect(staged.view).toMatchObject({ mode: 'capture', receipt: { fileName: 'photo.jpg' } })
    expect((await prisma.stagedReceipt.findUniqueOrThrow({ where: { id: staged.data.stagedReceiptId } })).source).toBe('file_param')
    const refused = await call(key, 'stage_receipt', { companyId: ids.aCompany, file: { download_url: 'https://169.254.169.254/latest/meta-data', file_id: 'x' } })
    expect(refused.ok).toBe(false)
    expect(refused.text).toContain('pas un fichier de ChatGPT')
    // The file then gets its fields
    const matched = await ok(key, 'file_receipt', { companyId: ids.aCompany, stagedReceiptId: staged.data.stagedReceiptId, ...FIELDS })
    expect(matched.data).toMatchObject({ executed: true, result: { action: 'match', outcome: 'matched' } })
  })

  it('lets a viewer prepare an expense report from a receipt, never attach one', async () => {
    const key = await apiKey('write', { user: VIEWER })
    const staged = await ok(key, 'stage_receipt', { companyId: ids.aCompany, contentBase64: jpeg('viewer').toString('base64'), fileName: 'v.jpg', ...FIELDS, amount: 12.4, paymentMethod: 'personal_card' })
    expect(staged.data).toMatchObject({ outcome: 'none', reason: 'personal_payment', expenseProposal: { amount: 12.4 } })
    expect(staged.view).toMatchObject({ canAttach: false, canExpense: true, proposal: { amount: 12.4 } })
    const attach = await call(key, 'file_receipt', { companyId: ids.aCompany, action: 'attach', stagedReceiptId: staged.data.stagedReceiptId, transactionId: ids.aBakery })
    expect(attach.ok).toBe(false)
    expect(await prisma.mcpPendingAction.count()).toBe(0)
    const expense = await ok(key, 'file_receipt', { companyId: ids.aCompany, action: 'expense', stagedReceiptId: staged.data.stagedReceiptId })
    expect(expense.data).toMatchObject({ executed: true, result: { action: 'expense', created: true, totalOwed: 12.4, reviewUrl: expect.stringContaining('/expense-reports/') } })
    expect(expense.view).toMatchObject({ mode: 'done', done: { kind: 'expense' } })
    const report = await prisma.expenseReport.findUniqueOrThrow({ where: { id: expense.data.result.reportId } })
    expect(report.status).toBe('DRAFT')
  })

  it('answers "Société introuvable" outside the grant, and "introuvable" for another company\'s receipt', async () => {
    const onlyA = await apiKey('write', { access: { allCompanies: false, companyIds: [ids.aCompany] } })
    for (const [tool, args] of [
      ['capture_receipt', {}],
      ['stage_receipt', { contentBase64: jpeg('x').toString('base64') }],
      ['file_receipt', { stagedReceiptId: 'sr-x' }],
    ] as const) {
      expect((await call(onlyA, tool, { companyId: ids.bCompany, ...args })).text, tool).toBe('Société introuvable')
    }
    const all = await apiKey('write')
    const staged = await ok(all, 'stage_receipt', { companyId: ids.aCompany, contentBase64: jpeg('a-only').toString('base64') })
    expect((await call(all, 'file_receipt', { companyId: ids.bCompany, stagedReceiptId: staged.data.stagedReceiptId, ...FIELDS })).text).toContain('Justificatif introuvable')
  })
})
