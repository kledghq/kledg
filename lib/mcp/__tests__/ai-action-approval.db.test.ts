/**
 * The approval page of actions prepared by assistants (POST
 * /api/ai-actions/[id]) against PostgreSQL, with real Better Auth sessions
 * (no mocked session): only the signed-in user who owns the action, from
 * this instance, with their password typed again, can approve it. The MCP
 * credential of the assistant (API key) does not authenticate there. The
 * key runs in validation mode (in automatic mode nothing waits for approval).
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('ai_action_approval')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { cookie: '' }
})

vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: state.cookie }) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { withSystemContext } from '@/lib/rls/context'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let auth: typeof import('@/lib/auth').auth
type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
let decide: Handler
let mcp: (request: Request) => Promise<Response>

const ORIGIN = 'http://localhost:3000'
const PASSWORD = 'correct-horse-battery'

async function account(email: string) {
  await auth.api.createUser({ body: { email, password: PASSWORD, name: email.split('@')[0], role: 'user' } })
  const { headers } = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true })
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, email: true, name: true, role: true } })
  return { user, cookie }
}

async function tool(key: string, name: string, args: Record<string, unknown>) {
  const response = await mcp(
    new Request(`${ORIGIN}/api/mcp`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }),
  )
  const text = await response.text()
  const raw = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? 'null')
  const body = JSON.parse(raw) as { result?: { content?: Array<{ text: string }>; isError?: boolean } }
  const out = body.result?.content?.[0]?.text ?? ''
  return { ok: !body.result?.isError, text: out, data: body.result?.isError ? {} : (JSON.parse(out) as Record<string, string>) }
}

function post(id: string, body: unknown, headers: Record<string, string>) {
  return decide(
    new NextRequest(`${ORIGIN}/api/ai-actions/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

describe.skipIf(!available)('approval of actions prepared by assistants', () => {
  beforeAll(async () => {
    await prepareTestDatabase('ai_action_approval')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
    decide = ((await import('@/app/api/ai-actions/[id]/route')) as unknown as { POST: Handler }).POST
    mcp = ((await import('@/app/api/mcp/route')) as unknown as { POST: (r: Request) => Promise<Response> }).POST
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('ai_action_approval')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('requires the owner session, same origin, JSON and the password; the assistant key does not work', async () => {
    const owner = await account('owner@test.local')
    const other = await account('other@test.local')
    const company = await prisma.company.create({ data: { name: 'Alpha', slug: 'alpha', siren: '111111111' } })
    await prisma.organization.create({ data: { id: 'org-a', name: 'Alpha', slug: 'org-alpha', createdAt: new Date(), companyId: company.id } })
    await prisma.member.create({ data: { id: 'm-1', userId: owner.user.id, organizationId: 'org-a', role: 'companyAdmin', createdAt: new Date() } })
    await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'OD' } })
    const { createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service')
    const key = (await createApiKeyWithGrant({ ...owner.user }, 'Assistant', { allCompanies: true, companyIds: [] }, 'admin', 'validation')).key

    const dry = await tool(key, 'create_journal', { companyId: company.id, code: 'ZZ', label: 'Test' })
    expect(dry.ok, dry.text).toBe(true) // direct tool, no approval needed
    const rule = await prisma.transactionRule.create({ data: { companyId: company.id, name: 'Règle' } })
    const pending = await tool(key, 'delete_rule', { companyId: company.id, ruleId: rule.id })
    const id = pending.data.actionId
    expect(id).toMatch(/^act_/)

    const approve = { decision: 'approve', password: PASSWORD }
    // The assistant's own credential: no session, 401.
    expect((await post(id, approve, { 'x-api-key': key, authorization: `Bearer ${key}` })).status).toBe(401)
    // Cross-site with the owner's cookie: 403.
    state.cookie = owner.cookie
    expect((await post(id, approve, { cookie: owner.cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    // Text body (no preflight): 415.
    const text = await decide(
      new NextRequest(`${ORIGIN}/api/ai-actions/${id}`, { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'text/plain' }, body: JSON.stringify(approve) }),
      { params: Promise.resolve({ id }) },
    )
    expect(text.status).toBe(415)
    // Wrong password.
    expect((await post(id, { ...approve, password: 'wrong-password-123' }, { cookie: owner.cookie, origin: ORIGIN })).status).toBeGreaterThanOrEqual(400)
    // Another user: 404.
    state.cookie = other.cookie
    expect((await post(id, { decision: 'approve', password: PASSWORD }, { cookie: other.cookie, origin: ORIGIN })).status).toBe(404)
    // Read by the test itself, not as the signed-in user of the mocked cookie (row level security).
    expect((await withSystemContext('test', () => prisma.mcpPendingAction.findUniqueOrThrow({ where: { id } }))).status).toBe('pending')

    // The owner approves; the assistant executes once.
    state.cookie = owner.cookie
    expect((await post(id, approve, { cookie: owner.cookie, origin: ORIGIN })).status).toBe(200)
    expect((await post(id, approve, { cookie: owner.cookie, origin: ORIGIN })).status).toBe(409)
    const done = await tool(key, 'delete_rule', { companyId: company.id, ruleId: rule.id, actionId: id })
    expect(done.ok, done.text).toBe(true)
    expect(await withSystemContext('test', () => prisma.transactionRule.count({ where: { id: rule.id } }))).toBe(0)
    expect(await withSystemContext('test', () => prisma.auditLog.count({ where: { action: 'MCP_ACTION_APPROVED' } }))).toBe(1)
  })

  it('shows the approval page only while a connection uses validation mode or an action waits', async () => {
    const { approvalPageAvailable, setGrant } = await import('@/lib/ai-access/manage-grants.service')
    const owner = await account('pages@test.local')
    const { createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service')
    const created = await createApiKeyWithGrant({ ...owner.user }, 'Auto', { allCompanies: true, companyIds: [] }, 'admin')
    expect(created.executionMode).toBe('automatic')
    expect(await approvalPageAvailable(owner.user.id)).toBe(false)
    const target = { kind: 'apiKey' as const, apiKeyId: created.id }
    await setGrant({ ...owner.user }, target, { allCompanies: true, companyIds: [] }, 'validation')
    expect(await approvalPageAvailable(owner.user.id)).toBe(true)
    await setGrant({ ...owner.user }, target, { allCompanies: true, companyIds: [] }, 'automatic')
    expect(await approvalPageAvailable(owner.user.id)).toBe(false)
  })
})
