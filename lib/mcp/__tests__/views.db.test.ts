/**
 * The MCP Apps views (docs/mcp-views.md) against PostgreSQL, through the
 * real /api/mcp handler with API keys (session mocked; services, triggers
 * and row level security real):
 * - the templates are listed and read as ui:// resources with the MCP Apps
 *   mime type;
 * - each wired tool declares its template in tools/list and returns, besides
 *   its JSON text (unchanged), a structuredContent matching the schema of
 *   that template; the statements carry their N-1 column;
 * - a button of the actionable list is a plain tools/call: with a key in
 *   validation mode, "Valider" returns the dry run and the approval link,
 *   and the draft stays a draft; without full control there is no button.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('mcp_views')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { AccessLevel, ExecutionMode } from '@/lib/ai-access/access'
import { VIEWS, VIEW_MIME_TYPE } from '@/lib/mcp/views'
import { VIEW_SCHEMAS, type ViewName } from '@/lib/mcp/views/schemas'

const available = await testDatabaseAvailable()

type Handler = (request: Request) => Promise<Response>

let prisma: typeof import('@/lib/prisma').prisma
let mcp: Record<'POST', Handler>
let createApiKeyWithGrant: typeof import('@/lib/ai-access/create-api-key.service').createApiKeyWithGrant

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }

const CHART: Array<[string, string]> = [
  ['101', 'Capital'],
  ['401', 'Fournisseurs'],
  ['411', 'Clients'],
  ['44566', 'TVA sur autres biens et services'],
  ['44571', 'TVA collectée'],
  ['512', 'Banques'],
  ['512000', 'Banque'],
  ['606100', 'Fournitures non stockables'],
  ['706000', 'Prestations de services'],
]

const ids = {} as Record<string, string>
const STATEMENT = ['Date;Libellé;Montant', '15/03/2025;PRLV FOURNITURES MARTIN;-120,00', '20/03/2025;VIR CLIENT DUPONT;1200,00'].join('\n')
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/** Read tools wired to a template, with arguments, the template and texts the data must contain. */
const READ_CALLS: Array<{ tool: string; view: ViewName; args: () => Record<string, unknown>; expect: string[] }> = [
  { tool: 'get_balance_sheet', view: 'statement', args: () => ({}), expect: ['Bilan, Société A', 'Exercice 2024'] },
  { tool: 'get_income_statement', view: 'statement', args: () => ({}), expect: ['Compte de résultat, Société A', 'Exercice 2024'] },
  { tool: 'get_trial_balance', view: 'statement', args: () => ({ startDate: '2025-01-01', endDate: '2025-12-31' }), expect: ['Balance générale', '706000'] },
  { tool: 'get_tiers_flows', view: 'chart', args: () => ({ fiscalYearId: ids.fy2025 }), expect: ['Maison Dupont', 'flow-customer'] },
  { tool: 'list_entries', view: 'actions', args: () => ({ status: 'draft' }), expect: ['Écritures en brouillon', 'Achat fournitures'] },
  { tool: 'list_bank_transactions', view: 'actions', args: () => ({}), expect: ['Transactions à rapprocher', 'VIR CLIENT DUPONT'] },
  { tool: 'list_missing_receipts', view: 'actions', args: () => ({ fiscalYearId: ids.fy2025 }), expect: ['Justificatifs manquants'] },
]

async function entry(fiscalYear: string, date: string, description: string, status: 'draft' | 'validated', lines: Array<[string, number, number, string?]>) {
  const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
  const journal = await prisma.journal.findFirstOrThrow({ where: { companyId: ids.company, code: 'OD' } })
  return createEntry({
    companyId: ids.company,
    journalId: journal.id,
    date,
    description,
    status,
    lines: lines.map(([code, debit, credit, aux]) => ({
      accountId: ids[`${fiscalYear}:${code}`],
      debit,
      credit,
      ...(aux && { auxiliaryAccountNumber: aux, auxiliaryAccountLabel: 'Maison Dupont' }),
    })),
  })
}

async function seed() {
  await prepareTestDatabase('mcp_views')
  await prisma.user.create({ data: { id: OWNER.id, email: OWNER.email, name: OWNER.name, role: OWNER.role } })
  const company = await prisma.company.create({
    data: { name: 'Société A', slug: 'societe-a', siren: '123456782', legalType: 'SAS', closingDay: 31, closingMonth: 12, vatRegime: 'normal', corporateTaxRegime: 'simplified' },
  })
  ids.company = company.id
  await prisma.organization.create({ data: { id: 'org-a', name: company.name, slug: 'org-a', createdAt: new Date(), companyId: company.id } })
  await prisma.member.create({ data: { id: 'm-a-owner', userId: OWNER.id, organizationId: 'org-a', role: 'companyAdmin', createdAt: new Date() } })
  for (const year of [2024, 2025]) {
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year, startDate: day(`${year}-01-01`), endDate: day(`${year}-12-31`), closingDay: 31, closingMonth: 12 },
    })
    ids[`fy${year}`] = fy.id
    for (const [code, label] of CHART) {
      const account = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label, isPCG: true } })
      ids[`${year}:${code}`] = account.id
    }
  }
  for (const code of ['BQ', 'OD', 'AC', 'VE', 'AN']) await prisma.journal.create({ data: { companyId: company.id, code, label: code } })
  await entry('2024', '2024-06-10', 'Vente 2024', 'validated', [['411', 600, 0, 'C00001'], ['706000', 0, 500], ['44571', 0, 100]])
  await entry('2025', '2025-03-10', 'Vente Dupont', 'validated', [['411', 1200, 0, 'C00001'], ['706000', 0, 1000], ['44571', 0, 200]])
  await entry('2025', '2025-03-12', 'Achat fournitures', 'draft', [['606100', 100, 0], ['44566', 20, 0], ['401', 0, 120]])
}

async function apiKey(level: AccessLevel, mode: ExecutionMode = 'validation'): Promise<string> {
  return (await createApiKeyWithGrant({ ...OWNER }, `Clé ${level} ${mode}`, { allCompanies: true, companyIds: [] }, level, mode)).key
}

type RpcResult = {
  tools?: Array<{ name: string; _meta?: { ui?: { resourceUri?: string } } }>
  resources?: Array<{ uri: string; mimeType?: string }>
  contents?: Array<{ uri: string; mimeType?: string; text?: string; _meta?: unknown }>
  content?: Array<{ text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
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
  const body = JSON.parse(raw) as { result?: RpcResult; error?: { message: string } }
  expect(body.error, JSON.stringify(body.error)).toBeUndefined()
  return body.result!
}

async function call(key: string, name: string, args: Record<string, unknown>) {
  const result = await rpc(key, 'tools/call', { name, arguments: { companyId: ids.company, ...args } })
  expect(result.isError, `${name}: ${result.content?.[0]?.text}`).toBeFalsy()
  return result
}

describe.skipIf(!available)('MCP Apps views', () => {
  beforeAll(async () => {
    await prepareTestDatabase('mcp_views')
    ;({ prisma } = await import('@/lib/prisma'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as Record<'POST', Handler>
    ;({ createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service'))
    await seed()
    // Two bank transactions of 2025, imported through the tools (automatic mode).
    const admin = await apiKey('admin', 'automatic')
    const account = JSON.parse((await call(admin, 'create_bank_account', { name: 'Compte courant', ledgerAccountCode: '512000' })).content![0].text)
    await call(admin, 'import_statement', { bankAccountId: account.id, fileName: 'releve.csv', contentBase64: Buffer.from(STATEMENT).toString('base64') })
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('lists and serves the templates as ui:// resources', async () => {
    const key = await apiKey('read')
    const listed = (await rpc(key, 'resources/list')).resources ?? []
    for (const view of Object.values(VIEWS)) {
      expect(listed.find((r) => r.uri === view.uri)?.mimeType, view.uri).toBe(VIEW_MIME_TYPE)
      const [content] = (await rpc(key, 'resources/read', { uri: view.uri })).contents ?? []
      expect(content).toMatchObject({ uri: view.uri, mimeType: 'text/html;profile=mcp-app' })
      expect(content.text).toMatch(/^<!DOCTYPE html>/)
      expect(content._meta).toEqual({ ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }, prefersBorder: true } })
    }
  })

  it('declares the template of each wired tool in tools/list', async () => {
    const tools = (await rpc(await apiKey('read'), 'tools/list')).tools ?? []
    for (const { tool, view } of READ_CALLS) {
      expect(tools.find((t) => t.name === tool)?._meta?.ui?.resourceUri, tool).toBe(VIEWS[view].uri)
    }
    expect(tools.find((t) => t.name === 'list_companies')?._meta?.ui).toBeUndefined()
  })

  it('returns the unchanged JSON text and the view data of each wired tool', async () => {
    const key = await apiKey('read')
    for (const { tool, view, args, expect: texts } of READ_CALLS) {
      const result = await call(key, tool, args())
      expect(() => JSON.parse(result.content![0].text), tool).not.toThrow()
      const data = result.structuredContent
      expect(data?.view, tool).toBe(view)
      const parsed = VIEW_SCHEMAS[view].safeParse(data)
      expect(parsed.success, `${tool}: ${JSON.stringify(parsed.error?.issues?.slice(0, 3))}`).toBe(true)
      const serialized = JSON.stringify(data)
      for (const text of texts) expect(serialized, `${tool}: ${text}`).toContain(text)
    }
    // A read connection gets no tool button: links and messages only.
    const drafts = (await call(key, 'list_entries', { status: 'draft' })).structuredContent as { items: Array<{ actions: Array<{ kind: string }> }>; executionMode: unknown }
    expect(drafts.executionMode).toBeNull()
    expect(drafts.items.flatMap((i) => i.actions).every((a) => a.kind !== 'tool')).toBe(true)
  })

  it('gives the statements their N-1 column', async () => {
    const result = await call(await apiKey('read'), 'get_income_statement', { fiscalYearId: ids.fy2025 })
    const data = result.structuredContent as { columns: Array<{ label: string }>; sections: Array<{ total: { values: number[] } }> }
    expect(data.columns.map((c) => c.label)).toEqual(['Exercice 2025', 'Exercice 2024'])
    expect(data.sections[0].total.values).toEqual([1000, 500])
  })

  it('runs a button through the server: the dry run and the approval link in validation mode, nothing validated', async () => {
    const key = await apiKey('admin', 'validation')
    const list = (await call(key, 'list_entries', { status: 'draft' })).structuredContent as {
      executionMode: string
      items: Array<{ id: string; actions: Array<{ kind: string; label: string; tool?: string; arguments?: Record<string, unknown>; highImpact?: boolean }> }>
    }
    expect(list.executionMode).toBe('validation')
    const validate = list.items[0].actions.find((a) => a.kind === 'tool' && a.tool === 'validate_entries')!
    expect(validate).toMatchObject({ highImpact: true, arguments: { companyId: ids.company, entryIds: [list.items[0].id] } })

    const dry = await rpc(key, 'tools/call', { name: validate.tool, arguments: validate.arguments })
    const preview = JSON.parse(dry.content![0].text)
    expect(preview).toMatchObject({ dryRun: true })
    expect(preview.approvalUrl).toMatch(/^http:\/\/localhost:3000\//)
    expect(typeof preview.actionId).toBe('string')
    const draft = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: list.items[0].id } })
    expect(draft.status).toBe('draft')
  })
})
