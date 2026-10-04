/**
 * Company grants of AI assistants and API keys, against PostgreSQL (session
 * mocked, Better Auth real):
 * - storage and defaults (no grant = every company), routes and their
 *   permissions (owner only, 404 for companies or keys of others, 401);
 * - the consent page flow (grant saved for the user and the client);
 * - enforcement in every MCP tool: list filtering, refused companies and
 *   objects of a refused company, write tool, changes applied on the next call;
 * - cleanup when a consent is revoked, a key or a company is deleted.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('ai_access')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { McpAccess, McpCaller } from '@/lib/mcp/company-access'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>

let prisma: typeof import('@/lib/prisma').prisma
let auth: typeof import('@/lib/auth').auth
let registerKledgTools: typeof import('@/lib/mcp/tools').registerKledgTools
const routes = {} as Record<'grants' | 'assistants' | 'apiKeys' | 'apiKey' | 'mcp', Record<string, Handler>>

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }
const OTHER = { id: 'u-other', email: 'other@test.local', name: 'Other', role: 'user' }
const CLIENT = 'client-claude'
const OTHER_CLIENT = 'client-chatgpt'

/** Rows of companies A and B (owner is a member of both) and C (owner is not a member). */
const ids = {} as Record<string, string>

async function seedCompany(prefix: 'a' | 'b' | 'c', name: string, siren: string, members: string[]) {
  const company = await prisma.company.create({ data: { name, slug: `societe-${prefix}`, siren } })
  await prisma.organization.create({
    data: { id: `org-${prefix}`, name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id },
  })
  for (const userId of members) {
    await prisma.member.create({
      data: { id: `m-${prefix}-${userId}`, userId, organizationId: `org-${prefix}`, role: 'companyAdmin', createdAt: new Date() },
    })
  }
  const fy = await prisma.fiscalYear.create({
    data: {
      companyId: company.id,
      year: 2026,
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2026-12-31T00:00:00Z'),
    },
  })
  await prisma.account.createMany({
    data: [
      { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque' },
      { companyId: company.id, fiscalYearId: fy.id, code: '706000', label: 'Ventes' },
    ],
  })
  await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })
  const connection = await prisma.bankConnection.create({
    data: { companyId: company.id, login: `login-${prefix}`, secretKeyEncrypted: 'x' },
  })
  const bankAccount = await prisma.bankAccount.create({
    data: { bankConnectionId: connection.id, externalAccountId: `ext-${prefix}`, name: 'Compte courant' },
  })
  await prisma.bankTransaction.create({
    data: {
      bankAccountId: bankAccount.id,
      externalTransactionId: `tx-${prefix}`,
      amount: 100,
      date: new Date('2026-03-05T00:00:00Z'),
      side: 'credit',
      label: `Virement ${name}`,
    },
  })
  Object.assign(ids, { [`${prefix}Company`]: company.id, [`${prefix}Fy`]: fy.id })
}

async function seed() {
  await prepareTestDatabase('ai_access')
  for (const user of [OWNER, OTHER]) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  }
  await seedCompany('a', 'Atelier Alpha', '111111111', [OWNER.id])
  await seedCompany('b', 'Bureau Beta', '222222222', [OWNER.id, OTHER.id])
  await seedCompany('c', 'Cabinet Gamma', '333333333', [OTHER.id])
  for (const clientId of [CLIENT, OTHER_CLIENT]) {
    await prisma.oauthClient.create({ data: { id: `oc-${clientId}`, clientId, redirectUris: ['https://example.test/cb'] } })
  }
}

async function consent(userId: string, clientId: string) {
  await prisma.oauthConsent.create({
    data: { id: `consent-${userId}-${clientId}`, userId, clientId, scopes: ['kledg:read', 'kledg:write'] },
  })
}

function call(route: keyof typeof routes, method: string, path: string, body?: unknown, params?: Record<string, string>) {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return routes[route][method](request, { params: Promise.resolve(params ?? {}) })
}

const as = (user: typeof OWNER | null) => {
  state.user = user ? { ...user } : null
}

/** Registers the MCP tools for a caller and returns their handlers. */
function tools(caller: McpCaller, canWrite = true): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => handlers.set(name, handler),
  }
  const access: McpAccess = { user: { ...OWNER }, canWrite, canAdmin: false, caller, executionMode: 'automatic' }
  registerKledgTools(server as never, access)
  return handlers
}

async function listCompanyIds(handlers: Map<string, ToolHandler>): Promise<string[]> {
  const result = await handlers.get('list_companies')!({})
  expect(result.isError).toBeFalsy()
  return (JSON.parse(result.content[0].text) as Array<{ id: string }>).map((c) => c.id).sort()
}

/** Every tool that takes a company, with valid arguments for `companyId`. */
function companyCalls(companyId: string, fiscalYearId?: string): Array<[string, Record<string, unknown>]> {
  return [
    ['list_fiscal_years', { companyId }],
    ['list_journals', { companyId }],
    ['search_accounts', { companyId, fiscalYearId, query: '512' }],
    ['get_trial_balance', { companyId, startDate: '2026-01-01', endDate: '2026-12-31' }],
    ['get_balance_sheet', { companyId, fiscalYearId, variant: 'simplified' }],
    ['get_income_statement', { companyId, fiscalYearId, variant: 'simplified' }],
    ['list_entries', { companyId, fiscalYearId, limit: 50 }],
    ['list_bank_transactions', { companyId, onlyUnreconciled: true, limit: 50 }],
    [
      'create_draft_entry',
      {
        companyId,
        journalCode: 'BQ',
        date: '2026-03-10',
        description: 'Vente via assistant',
        lines: [
          { accountCode: '512000', debit: 10, credit: 0 },
          { accountCode: '706000', debit: 0, credit: 10 },
        ],
      },
    ],
  ]
}

const NOT_FOUND = 'Société introuvable'

describe.skipIf(!available)('AI access grants', () => {
  beforeAll(async () => {
    await prepareTestDatabase('ai_access')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
    ;({ registerKledgTools } = await import('@/lib/mcp/tools'))
    routes.grants = (await import('@/app/api/ai-access/grants/route')) as unknown as Record<string, Handler>
    routes.assistants = (await import('@/app/api/ai-access/assistants/route')) as unknown as Record<string, Handler>
    routes.apiKeys = (await import('@/app/api/ai-access/api-keys/route')) as unknown as Record<string, Handler>
    routes.apiKey = (await import('@/app/api/ai-access/api-keys/[id]/route')) as unknown as Record<string, Handler>
    routes.mcp = (await import('@/app/api/mcp/route')) as unknown as Record<string, Handler>
  }, 60_000)

  beforeEach(seed)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('storage and defaults', () => {
    it('gives no company to a connection without a grant (fail closed)', async () => {
      const { getGrant } = await import('@/lib/ai-access/manage-grants.service')
      expect(await getGrant(OWNER.id, { kind: 'oauth', clientId: CLIENT })).toEqual({ allCompanies: false, companyIds: [] })
      await consent(OWNER.id, CLIENT)
      expect(await listCompanyIds(tools({ kind: 'oauth', clientId: CLIENT }))).toEqual([])
    })

    it('saves, lists and replaces a grant per user and client', async () => {
      as(OWNER)
      const saved = await call('assistants', 'PUT', '/api/ai-access/assistants', {
        clientId: CLIENT,
        access: { allCompanies: false, companyIds: [ids.aCompany] },
      })
      expect(saved.status).toBe(200)
      await call('assistants', 'PUT', '/api/ai-access/assistants', {
        clientId: CLIENT,
        access: { allCompanies: false, companyIds: [ids.bCompany, ids.aCompany] },
      })
      const listed = await (await call('grants', 'GET', '/api/ai-access/grants')).json()
      expect(listed).toEqual({
        assistants: [{ clientId: CLIENT, allCompanies: false, companyIds: [ids.aCompany, ids.bCompany].sort(), executionMode: 'automatic' }],
        apiKeys: [],
      })
      expect(await prisma.aiAccessGrant.count()).toBe(1)

      // Another user's grants are separate and never listed.
      as(OTHER)
      expect(await (await call('grants', 'GET', '/api/ai-access/grants')).json()).toEqual({ assistants: [], apiKeys: [] })
    })

    it('refuses an empty explicit list', async () => {
      as(OWNER)
      const response = await call('assistants', 'PUT', '/api/ai-access/assistants', {
        clientId: CLIENT,
        access: { allCompanies: false, companyIds: [] },
      })
      expect(response.status).toBe(400)
    })
  })

  describe('route permissions', () => {
    it('answers 401 when signed out', async () => {
      as(null)
      expect((await call('grants', 'GET', '/api/ai-access/grants')).status).toBe(401)
      expect(
        (await call('assistants', 'PUT', '/api/ai-access/assistants', { clientId: CLIENT, access: { allCompanies: true, companyIds: [] } })).status,
      ).toBe(401)
      expect(
        (await call('apiKeys', 'POST', '/api/ai-access/api-keys', { name: 'x', access: { allCompanies: true, companyIds: [] } })).status,
      ).toBe(401)
      expect(
        (await call('apiKey', 'PUT', '/api/ai-access/api-keys/k', { access: { allCompanies: true, companyIds: [] } }, { id: 'k' })).status,
      ).toBe(401)
    })

    it('answers 404 for a company the user is not a member of, and saves nothing', async () => {
      as(OWNER)
      const response = await call('assistants', 'PUT', '/api/ai-access/assistants', {
        clientId: CLIENT,
        access: { allCompanies: false, companyIds: [ids.aCompany, ids.cCompany] },
      })
      expect(response.status).toBe(404)
      expect(((await response.json()) as { error: string }).error).toBe(NOT_FOUND)
      expect(await prisma.aiAccessGrant.count()).toBe(0)

      const key = await call('apiKeys', 'POST', '/api/ai-access/api-keys', {
        name: 'Script',
        access: { allCompanies: false, companyIds: [ids.cCompany] },
      })
      expect(key.status).toBe(404)
      // The key created before the grant failed was deleted again.
      expect(await prisma.apikey.count()).toBe(0)
    })

    it('answers 404 for an unknown assistant', async () => {
      as(OWNER)
      const response = await call('assistants', 'PUT', '/api/ai-access/assistants', {
        clientId: 'unknown-client',
        access: { allCompanies: true, companyIds: [] },
      })
      expect(response.status).toBe(404)
    })

    it("only lets the owner of an API key change its access (404 for someone else's key)", async () => {
      as(OWNER)
      const created = (await (
        await call('apiKeys', 'POST', '/api/ai-access/api-keys', { name: 'Script', access: { allCompanies: true, companyIds: [] } })
      ).json()) as { id: string }
      as(OTHER)
      const response = await call(
        'apiKey',
        'PUT',
        `/api/ai-access/api-keys/${created.id}`,
        { access: { allCompanies: false, companyIds: [ids.bCompany] } },
        { id: created.id },
      )
      expect(response.status).toBe(404)
      expect(((await response.json()) as { error: string }).error).toBe('Clé API introuvable')
      const grant = await prisma.aiAccessGrant.findUnique({ where: { apiKeyId: created.id } })
      expect(grant?.allCompanies).toBe(true)
    })
  })

  describe('consent page flow', () => {
    it('saves the grant for the signed-in user and the client before the consent is accepted', async () => {
      as(OWNER)
      // What the consent page does on "Autoriser": save the grant, then accept (consent row).
      const response = await call('assistants', 'PUT', '/api/ai-access/assistants', {
        clientId: CLIENT,
        access: { allCompanies: false, companyIds: [ids.bCompany] },
      })
      expect(response.status).toBe(200)
      await consent(OWNER.id, CLIENT)

      const grant = await prisma.aiAccessGrant.findFirst({ include: { companies: true } })
      expect(grant).toMatchObject({ userId: OWNER.id, clientId: CLIENT, apiKeyId: null, allCompanies: false })
      expect(grant?.companies.map((c) => c.companyId)).toEqual([ids.bCompany])
      expect(await listCompanyIds(tools({ kind: 'oauth', clientId: CLIENT }))).toEqual([ids.bCompany])
      // Another assistant of the same user consented without a grant: no company.
      await consent(OWNER.id, OTHER_CLIENT)
      expect(await listCompanyIds(tools({ kind: 'oauth', clientId: OTHER_CLIENT }))).toEqual([])
    })
  })

  describe('API keys', () => {
    it('creates a key with its grant, gives no company to a key without one, and edits the grant', async () => {
      as(OWNER)
      const response = await call('apiKeys', 'POST', '/api/ai-access/api-keys', {
        name: 'Claude Code',
        access: { allCompanies: false, companyIds: [ids.aCompany] },
      })
      expect(response.status).toBe(201)
      const created = (await response.json()) as { id: string; key: string; access: unknown }
      expect(created.key).toMatch(/^kledg_/)
      expect(created.access).toEqual({ allCompanies: false, companyIds: [ids.aCompany] })
      expect(await listCompanyIds(tools({ kind: 'apiKey', apiKeyId: created.id }))).toEqual([ids.aCompany])

      // A key without a grant row reaches no company (migration 20261011120000 wrote the grants of older keys).
      const legacy = await auth.api.createApiKey({ body: { name: 'Ancienne', userId: OWNER.id } })
      expect(await listCompanyIds(tools({ kind: 'apiKey', apiKeyId: legacy.id }))).toEqual([])

      const edited = await call(
        'apiKey',
        'PUT',
        `/api/ai-access/api-keys/${legacy.id}`,
        { access: { allCompanies: false, companyIds: [ids.bCompany] } },
        { id: legacy.id },
      )
      expect(edited.status).toBe(200)
      expect(await listCompanyIds(tools({ kind: 'apiKey', apiKeyId: legacy.id }))).toEqual([ids.bCompany])
    })

    it('creates a key in automatic mode unless validation is chosen, and edits the mode', async () => {
      as(OWNER)
      const access = { allCompanies: true, companyIds: [] }
      const automatic = (await (await call('apiKeys', 'POST', '/api/ai-access/api-keys', { name: 'Auto', access, level: 'admin' })).json()) as {
        id: string
        executionMode: string
      }
      expect(automatic.executionMode).toBe('automatic')
      const validation = (await (
        await call('apiKeys', 'POST', '/api/ai-access/api-keys', { name: 'Valid', access, level: 'admin', executionMode: 'validation' })
      ).json()) as { id: string; executionMode: string }
      expect(validation.executionMode).toBe('validation')
      expect((await call('apiKeys', 'POST', '/api/ai-access/api-keys', { name: 'Bad', access, executionMode: 'yolo' })).status).toBe(400)

      const { getExecutionMode } = await import('@/lib/ai-access/manage-grants.service')
      const edited = await call('apiKey', 'PUT', `/api/ai-access/api-keys/${automatic.id}`, { access, executionMode: 'validation' }, { id: automatic.id })
      expect(edited.status).toBe(200)
      expect(await getExecutionMode(OWNER.id, { kind: 'apiKey', apiKeyId: automatic.id })).toBe('validation')
      // Editing the companies only keeps the mode.
      await call('apiKey', 'PUT', `/api/ai-access/api-keys/${automatic.id}`, { access: { allCompanies: false, companyIds: [ids.aCompany] } }, { id: automatic.id })
      expect(await getExecutionMode(OWNER.id, { kind: 'apiKey', apiKeyId: automatic.id })).toBe('validation')

      const listed = (await (await call('grants', 'GET', '/api/ai-access/grants')).json()) as { apiKeys: Array<{ apiKeyId: string; executionMode: string }> }
      expect(Object.fromEntries(listed.apiKeys.map((k) => [k.apiKeyId, k.executionMode]))).toEqual({
        [automatic.id]: 'validation',
        [validation.id]: 'validation',
      })

      // The assistant route takes the mode chosen on the consent page or in "Modifier".
      await call('assistants', 'PUT', '/api/ai-access/assistants', { clientId: CLIENT, access, executionMode: 'validation' })
      expect(await getExecutionMode(OWNER.id, { kind: 'oauth', clientId: CLIENT })).toBe('validation')
    })

    it('restricts the real MCP endpoint called with the key', async () => {
      as(OWNER)
      const created = (await (
        await call('apiKeys', 'POST', '/api/ai-access/api-keys', {
          name: 'Script',
          access: { allCompanies: false, companyIds: [ids.aCompany] },
        })
      ).json()) as { key: string }

      const rpc = async (method: string, params: unknown) => {
        const response = await routes.mcp.POST(
          new Request('http://localhost:3000/api/mcp', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${created.key}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          }),
        )
        const text = await response.text()
        const json = text.trim().startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data: '))!.slice(6)
        return JSON.parse(json) as { result: ToolResult }
      }

      const listed = await rpc('tools/call', { name: 'list_companies', arguments: {} })
      expect((JSON.parse(listed.result.content[0].text) as Array<{ id: string }>).map((c) => c.id)).toEqual([ids.aCompany])
      const refused = await rpc('tools/call', { name: 'list_journals', arguments: { companyId: ids.bCompany } })
      expect(refused.result).toMatchObject({ isError: true, content: [{ text: NOT_FOUND }] })
    })
  })

  describe('enforcement in every MCP tool', () => {
    const restricted = async () => {
      as(OWNER)
      await consent(OWNER.id, CLIENT)
      await call('assistants', 'PUT', '/api/ai-access/assistants', {
        clientId: CLIENT,
        access: { allCompanies: false, companyIds: [ids.aCompany] },
      })
      return tools({ kind: 'oauth', clientId: CLIENT })
    }

    it('lists only granted companies', async () => {
      expect(await listCompanyIds(await restricted())).toEqual([ids.aCompany])
    })

    it('refuses every tool on a company the user is a member of but did not grant, like a non-member', async () => {
      const handlers = await restricted()
      for (const [name, args] of companyCalls(ids.bCompany, ids.bFy)) {
        const result = await handlers.get(name)!(args)
        expect(result, name).toMatchObject({ isError: true, content: [{ text: NOT_FOUND }] })
      }
      for (const [name, args] of companyCalls(ids.cCompany, ids.cFy)) {
        const result = await handlers.get(name)!(args)
        expect(result, `${name} (non-member)`).toMatchObject({ isError: true, content: [{ text: NOT_FOUND }] })
      }
      expect(await prisma.accountingEntry.count()).toBe(0)
    })

    it('accepts every tool on a granted company', async () => {
      const handlers = await restricted()
      for (const [name, args] of companyCalls(ids.aCompany, ids.aFy)) {
        const result = await handlers.get(name)!(args)
        expect(result.content[0].text, name).not.toBe(NOT_FOUND)
      }
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany, status: 'draft' } })).toBe(1)
    })

    it('does not reach objects of a refused company through a granted company', async () => {
      const handlers = await restricted()
      for (const name of ['search_accounts', 'get_balance_sheet', 'get_income_statement', 'list_entries']) {
        const result = await handlers.get(name)!({ companyId: ids.aCompany, fiscalYearId: ids.bFy, variant: 'simplified', limit: 50 })
        expect(result, name).toMatchObject({ isError: true, content: [{ text: 'Exercice introuvable pour cette société.' }] })
      }
    })

    it('only exposes create_draft_entry with kledg:write, and then within the grant', async () => {
      await restricted()
      expect(tools({ kind: 'oauth', clientId: CLIENT }, false).has('create_draft_entry')).toBe(false)
      const [, args] = companyCalls(ids.bCompany).find(([name]) => name === 'create_draft_entry')!
      const result = await tools({ kind: 'oauth', clientId: CLIENT }, true).get('create_draft_entry')!(args)
      expect(result).toMatchObject({ isError: true, content: [{ text: NOT_FOUND }] })
    })

    it('applies a change on the next call, without reconnecting', async () => {
      const handlers = await restricted()
      expect(await listCompanyIds(handlers)).toEqual([ids.aCompany])
      await call('assistants', 'PUT', '/api/ai-access/assistants', { clientId: CLIENT, access: { allCompanies: true, companyIds: [] } })
      expect(await listCompanyIds(handlers)).toEqual([ids.aCompany, ids.bCompany].sort())
      const journals = await handlers.get('list_journals')!({ companyId: ids.bCompany })
      expect(journals.isError).toBeFalsy()
    })
  })

  describe('full control guard', () => {
    const guardFor = async (canAdmin: boolean) => {
      const { companyGuard } = await import('@/lib/mcp/company-access')
      return companyGuard({ user: { ...OWNER }, canWrite: true, canAdmin, caller: { kind: 'oauth', clientId: CLIENT }, executionMode: 'automatic' })
    }
    const statusOf = (promise: Promise<void>) =>
      promise.then(
        () => 'ok',
        (error: { statusCode?: number; message: string }) => `${error.statusCode} ${error.message}`,
      )

    it('refuses a connection without kledg:admin, before anything else', async () => {
      await consent(OWNER.id, CLIENT)
      const result = await statusOf((await guardFor(false)).requireFullControl(ids.aCompany, { entries: ['validate'] }))
      expect(result).toMatch(/^403 Cette action demande le contrôle total/)
    })

    it('then applies the company grant and the user role like every tool', async () => {
      as(OWNER)
      await consent(OWNER.id, CLIENT)
      await call('assistants', 'PUT', '/api/ai-access/assistants', {
        clientId: CLIENT,
        access: { allCompanies: false, companyIds: [ids.aCompany] },
      })
      const guard = await guardFor(true)
      expect(await statusOf(guard.requireFullControl(ids.aCompany, { entries: ['validate'] }))).toBe('ok')
      expect(await statusOf(guard.requireFullControl(ids.bCompany, { entries: ['validate'] }))).toBe(`404 ${NOT_FOUND}`)
      expect(await statusOf(guard.requireFullControl(ids.cCompany, { entries: ['validate'] }))).toBe(`404 ${NOT_FOUND}`)
    })
  })

  describe('cleanup', () => {
    it('deletes the grant when the consent is revoked, and the revoked assistant reaches nothing', async () => {
      as(OWNER)
      await consent(OWNER.id, CLIENT)
      await call('assistants', 'PUT', '/api/ai-access/assistants', {
        clientId: CLIENT,
        access: { allCompanies: false, companyIds: [ids.aCompany] },
      })
      await prisma.oauthConsent.delete({ where: { id: `consent-${OWNER.id}-${CLIENT}` } })
      expect(await prisma.aiAccessGrant.count()).toBe(0)
      // Its access token may still be valid: it must not fall back to every company.
      const handlers = tools({ kind: 'oauth', clientId: CLIENT })
      expect(await listCompanyIds(handlers)).toEqual([])
      expect(await handlers.get('list_journals')!({ companyId: ids.aCompany })).toMatchObject({ isError: true, content: [{ text: NOT_FOUND }] })
    })

    it('deletes the grant with its API key', async () => {
      as(OWNER)
      const created = (await (
        await call('apiKeys', 'POST', '/api/ai-access/api-keys', {
          name: 'Script',
          access: { allCompanies: false, companyIds: [ids.aCompany] },
        })
      ).json()) as { id: string }
      expect(await prisma.aiAccessGrant.count()).toBe(1)
      await prisma.apikey.delete({ where: { id: created.id } })
      expect(await prisma.aiAccessGrant.count()).toBe(0)
      expect(await prisma.aiAccessGrantCompany.count()).toBe(0)
    })

    it('removes a deleted company from grants, and never widens a grant left empty', async () => {
      as(OWNER)
      await consent(OWNER.id, CLIENT)
      await call('assistants', 'PUT', '/api/ai-access/assistants', {
        clientId: CLIENT,
        access: { allCompanies: false, companyIds: [ids.aCompany] },
      })
      await prisma.company.delete({ where: { id: ids.aCompany } })
      expect(await prisma.aiAccessGrantCompany.count()).toBe(0)
      const grant = await prisma.aiAccessGrant.findFirst()
      expect(grant?.allCompanies).toBe(false)
      expect(await listCompanyIds(tools({ kind: 'oauth', clientId: CLIENT }))).toEqual([])
    })
  })
})
