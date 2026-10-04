/**
 * Access level and revocation of AI assistants, end to end against
 * PostgreSQL with the real Better Auth OAuth provider and the real /api/mcp
 * route (only the session of the app's own routes is mocked):
 * - the consent page can narrow the requested scopes (read only, drafts, full
 *   control), and the issued tokens carry only the accepted scopes (no
 *   create_draft_entry for read only, canAdmin only with kledg:admin);
 * - lowering an assistant from the settings page applies to its current and
 *   future tokens;
 * - the level of API keys (Better Auth key permissions);
 * - revoking an assistant deletes its refresh tokens, and an access token
 *   issued before the revocation is refused by /api/mcp right away.
 *
 * Skipped when the test database server is unreachable.
 */

import { createHash, randomBytes } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('assistant_tokens')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const BASE = 'http://localhost:3000'
const MCP_URL = `${BASE}/api/mcp`
const REDIRECT_URI = 'https://assistant.example.test/callback'
/** What MCP clients ask for (every level, as /api/mcp challenges with). */
const ALL_SCOPES = 'openid offline_access kledg:read kledg:write kledg:admin'
/** What the consent page sends for each level. */
const READ_ONLY = 'openid offline_access kledg:read'
const DRAFTS = 'openid offline_access kledg:read kledg:write'

type Handler = (request: Request) => Promise<Response>

let prisma: typeof import('@/lib/prisma').prisma
let auth: typeof import('@/lib/auth').auth
let mcp: Record<'POST', Handler>
let withMcpUser: typeof import('@/lib/mcp/auth').withMcpUser

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }
const OTHER = { id: 'u-other', email: 'other@test.local', name: 'Other', role: 'user' }
const PASSWORD = 'correct horse battery staple'

function authRequest(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('origin', BASE)
  if (init.cookie) headers.set('cookie', init.cookie)
  return auth.handler(new Request(`${BASE}/api/auth${path}`, { ...init, headers }))
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

async function signIn(user: typeof OWNER): Promise<string> {
  const response = await authRequest('/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: PASSWORD }),
  })
  expect(response.status).toBe(200)
  return cookieHeader(response)
}

/** Registers a public client the way Claude or ChatGPT do (RFC 7591). */
async function registerClient(): Promise<string> {
  const response = await authRequest('/oauth2/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Assistant de test',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: ALL_SCOPES,
    }),
  })
  expect(response.status, await response.clone().text()).toBeLessThan(300)
  return ((await response.json()) as { client_id: string }).client_id
}

function locationOf(response: Response, body: unknown): string {
  const fromBody = body as { url?: string; redirect_uri?: string } | null
  const location = response.headers.get('location') ?? fromBody?.url ?? fromBody?.redirect_uri
  if (!location) throw new Error(`No redirect (${response.status}): ${JSON.stringify(body)}`)
  return location
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

interface Tokens {
  access_token: string
  refresh_token?: string
  scope: string
}

/**
 * Runs the authorization code flow with PKCE for `user` and `clientId`: the
 * assistant asks for every scope, the user accepts `accepted` scopes on the
 * consent page (by default what the page preselects: drafts), the assistant
 * exchanges the code.
 */
async function connect(clientId: string, cookie: string, accepted = DRAFTS): Promise<Tokens> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: ALL_SCOPES,
    state: 'st',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP_URL,
  })
  const authorize = await authRequest(`/oauth2/authorize?${query}`, { cookie })
  let next = new URL(locationOf(authorize, await readJson(authorize)), BASE)
  if (next.pathname === '/consent') {
    const consent = await authRequest('/oauth2/consent', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accept: true,
        ...(accepted !== ALL_SCOPES && { scope: accepted }),
        oauth_query: next.search.slice(1),
      }),
    })
    const body = await readJson(consent)
    expect(consent.status, JSON.stringify(body)).toBeLessThan(400)
    next = new URL(locationOf(consent, body))
  }
  const code = next.searchParams.get('code')
  expect(code, next.toString()).toBeTruthy()
  const token = await authRequest('/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource: MCP_URL,
    }),
  })
  const tokens = (await readJson(token)) as Tokens
  expect(token.status, JSON.stringify(tokens)).toBe(200)
  return tokens
}

async function refresh(clientId: string, refreshToken: string): Promise<Response> {
  return authRequest('/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource: MCP_URL }),
  })
}

function scopesOfJwt(token: string): string[] {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { scope?: string }
  return (payload.scope ?? '').split(' ').filter(Boolean)
}

/** Calls /api/mcp with an access token; returns the status and the JSON-RPC result. */
async function rpc(token: string, method: string, params: unknown = {}) {
  const response = await mcp.POST(
    new Request(MCP_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  const text = await response.text()
  const json = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? 'null')
  return { status: response.status, headers: response.headers, body: JSON.parse(json) as { result?: { tools?: Array<{ name: string }> } } }
}

async function toolNames(token: string): Promise<string[]> {
  const { status, body } = await rpc(token, 'tools/list')
  expect(status).toBe(200)
  return (body.result?.tools ?? []).map((t) => t.name)
}

/**
 * What /api/mcp hands the tools for a bearer token or API key: the same
 * authentication (lib/mcp/auth.ts), with a handler that records the access.
 * Null when the request is refused.
 */
async function accessOf(credential: string): Promise<{ canWrite: boolean; canAdmin: boolean } | null> {
  const seen: { access: { canWrite: boolean; canAdmin: boolean } | null } = { access: null }
  const response = await withMcpUser(async (_request, access) => {
    seen.access = { canWrite: access.canWrite, canAdmin: access.canAdmin }
    return new Response('ok')
  })(new Request(MCP_URL, { method: 'POST', headers: { authorization: `Bearer ${credential}` } }))
  return response.status === 200 ? seen.access : null
}

/** Users with a password, created once: Better Auth seeds its resources once per process. */
async function seedUsers() {
  const ctx = await auth.$context
  const hash = await ctx.password.hash(PASSWORD)
  for (const user of [OWNER, OTHER]) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: true } })
    await prisma.authAccount.create({
      data: { id: `acc-${user.id}`, accountId: user.id, providerId: 'credential', userId: user.id, password: hash },
    })
  }
}

/** Every test starts without clients, consents, tokens, sessions, grants or API keys. */
async function clearOAuth() {
  await prisma.oauthClient.deleteMany()
  await prisma.session.deleteMany()
  await prisma.aiAccessGrant.deleteMany()
  await prisma.apikey.deleteMany()
}

describe.skipIf(!available)('assistant access level and revocation', () => {
  const realFetch = globalThis.fetch

  beforeAll(async () => {
    await prepareTestDatabase('assistant_tokens')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as Record<'POST', Handler>
    ;({ withMcpUser } = await import('@/lib/mcp/auth'))
    await seedUsers()
    // /api/mcp verifies tokens against the instance's JWKS over HTTP: serve it in process.
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.startsWith(`${BASE}/api/auth/`)) return auth.handler(new Request(input, init))
      return realFetch(input, init)
    })
  }, 60_000)

  beforeEach(clearOAuth)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
  })

  async function consentOf(userId: string, clientId: string) {
    const consent = await prisma.oauthConsent.findFirst({ where: { userId, clientId } })
    expect(consent).not.toBeNull()
    return consent!
  }

  async function refreshTokens(userId: string, clientId: string) {
    return prisma.oauthRefreshToken.findMany({ where: { userId, clientId } })
  }

  describe('access level chosen on the consent page', () => {
    it('issues tokens without kledg:write when the user picks read only, and hides create_draft_entry', async () => {
      const clientId = await registerClient()
      const tokens = await connect(clientId, await signIn(OWNER), READ_ONLY)

      expect(tokens.scope.split(' ')).not.toContain('kledg:write')
      expect(scopesOfJwt(tokens.access_token)).toEqual(['kledg:read'])
      expect((await consentOf(OWNER.id, clientId)).scopes).not.toContain('kledg:write')
      const [stored] = await refreshTokens(OWNER.id, clientId)
      expect(stored.scopes).not.toContain('kledg:write')

      const names = await toolNames(tokens.access_token)
      expect(names).toContain('list_companies')
      expect(names).not.toContain('create_draft_entry')

      // A refresh can't add the withdrawn scope back.
      const widened = await authRequest('/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token!,
          client_id: clientId,
          scope: 'kledg:read kledg:write',
          resource: MCP_URL,
        }),
      })
      expect(widened.status).toBe(400)
      const refreshed = (await (await refresh(clientId, tokens.refresh_token!)).json()) as Tokens
      expect(scopesOfJwt(refreshed.access_token)).toEqual(['kledg:read'])
    })

    it('grants kledg:write and create_draft_entry when the user keeps the requested access', async () => {
      const clientId = await registerClient()
      const tokens = await connect(clientId, await signIn(OWNER))
      expect(scopesOfJwt(tokens.access_token).sort()).toEqual(['kledg:read', 'kledg:write'])
      expect(await toolNames(tokens.access_token)).toContain('create_draft_entry')
    })
  })

  describe('full control (kledg:admin)', () => {
    it('is granted only when chosen on the consent page, and implies drafts', async () => {
      const clientId = await registerClient()
      const cookie = await signIn(OWNER)

      // The default choice (drafts) leaves kledg:admin out of the tokens.
      const drafts = await connect(clientId, cookie)
      expect(scopesOfJwt(drafts.access_token)).not.toContain('kledg:admin')
      expect(await accessOf(drafts.access_token)).toEqual({ canWrite: true, canAdmin: false })
      const widened = await authRequest('/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: drafts.refresh_token!,
          client_id: clientId,
          scope: 'kledg:read kledg:write kledg:admin',
          resource: MCP_URL,
        }),
      })
      expect(widened.status).toBe(400)

      // Chosen explicitly: the consent and the tokens carry it.
      const full = await connect(clientId, cookie, ALL_SCOPES)
      expect(scopesOfJwt(full.access_token).sort()).toEqual(['kledg:admin', 'kledg:read', 'kledg:write'])
      expect((await consentOf(OWNER.id, clientId)).scopes).toContain('kledg:admin')
      expect(await accessOf(full.access_token)).toEqual({ canWrite: true, canAdmin: true })
      expect(await toolNames(full.access_token)).toContain('create_draft_entry')
    })

    it('is refused to a read only connection', async () => {
      const clientId = await registerClient()
      const cookie = await signIn(OWNER)
      expect(await accessOf((await connect(clientId, cookie, READ_ONLY)).access_token)).toEqual({ canWrite: false, canAdmin: false })
    })

    it('is withdrawn at once when lowered to drafts from the settings page', async () => {
      const clientId = await registerClient()
      const cookie = await signIn(OWNER)
      const full = await connect(clientId, cookie, ALL_SCOPES)
      const consent = await consentOf(OWNER.id, clientId)
      const updated = await authRequest('/oauth2/update-consent', {
        method: 'POST',
        cookie,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: consent.id, update: { scopes: consent.scopes.filter((s) => s !== 'kledg:admin') } }),
      })
      expect(updated.status).toBe(200)
      // The old token still says kledg:admin; the consent no longer does.
      expect(await accessOf(full.access_token)).toEqual({ canWrite: true, canAdmin: false })
      for (const stored of await refreshTokens(OWNER.id, clientId)) expect(stored.scopes).not.toContain('kledg:admin')
    })
  })

  describe('level of API keys', () => {
    async function createKey(level?: 'read' | 'write' | 'admin'): Promise<string> {
      state.user = { ...OWNER }
      const route = (await import('@/app/api/ai-access/api-keys/route')) as unknown as Record<'POST', Handler>
      const response = await route.POST(
        new Request(`${BASE}/api/ai-access/api-keys`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: `Clé ${level ?? 'défaut'}`, access: { allCompanies: true, companyIds: [] }, ...(level && { level }) }),
        }),
      )
      expect(response.status).toBe(201)
      return ((await response.json()) as { key: string }).key
    }

    it('applies the level chosen at creation, drafts by default, full control only when chosen', async () => {
      expect(await accessOf(await createKey())).toEqual({ canWrite: true, canAdmin: false })
      expect(await accessOf(await createKey('read'))).toEqual({ canWrite: false, canAdmin: false })
      expect(await accessOf(await createKey('write'))).toEqual({ canWrite: true, canAdmin: false })
      expect(await accessOf(await createKey('admin'))).toEqual({ canWrite: true, canAdmin: true })
    })

    it('gives read only to a key without a level (fail closed; migration 20261011120000 wrote the level of older keys)', async () => {
      const legacy = await auth.api.createApiKey({ body: { name: 'Ancienne', userId: OWNER.id } })
      expect(await accessOf(legacy.key)).toEqual({ canWrite: false, canAdmin: false })
    })

    it('verifies a key without writing its row on every call, and refuses a deleted or disabled key at once', async () => {
      const { clearVerifiedApiKeys, verifyMcpApiKey, VERIFIED_TTL_MS } = await import('@/lib/mcp/api-key')
      clearVerifiedApiKeys()
      const key = await createKey('read')
      const row = () => prisma.apikey.findFirstOrThrow({ select: { id: true, updatedAt: true, requestCount: true, lastRequest: true } })

      expect(await accessOf(key)).toEqual({ canWrite: false, canAdmin: false })
      const first = await row()
      expect(first.lastRequest).not.toBeNull()
      for (let i = 0; i < 3; i++) expect(await accessOf(key)).toEqual({ canWrite: false, canAdmin: false })
      // Better Auth wrote the row once (first use); the next calls only read it.
      expect(await row()).toEqual(first)

      // Verified again by Better Auth once the minute has passed: "dernière utilisation" stays current.
      expect(await verifyMcpApiKey(key, Date.now() + VERIFIED_TTL_MS + 1_000)).toMatchObject({ id: first.id })
      expect((await row()).requestCount).toBeGreaterThan(first.requestCount ?? 0)

      await prisma.apikey.update({ where: { id: first.id }, data: { enabled: false } })
      expect(await accessOf(key)).toBeNull()
      await prisma.apikey.update({ where: { id: first.id }, data: { enabled: true } })
      expect(await accessOf(key)).not.toBeNull()
      await prisma.apikey.delete({ where: { id: first.id } })
      expect(await accessOf(key)).toBeNull()
    })

    it('refuses an unknown level', async () => {
      state.user = { ...OWNER }
      const route = (await import('@/app/api/ai-access/api-keys/route')) as unknown as Record<'POST', Handler>
      const response = await route.POST(
        new Request(`${BASE}/api/ai-access/api-keys`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x', access: { allCompanies: true, companyIds: [] }, level: 'root' }),
        }),
      )
      expect(response.status).toBe(400)
    })
  })

  describe('lowering the access level from the settings page', () => {
    it('applies to the access and refresh tokens already issued; raising it takes a new consent', async () => {
      const clientId = await registerClient()
      const cookie = await signIn(OWNER)
      const tokens = await connect(clientId, cookie)
      expect(await toolNames(tokens.access_token)).toContain('create_draft_entry')

      // What the settings dialog does: Better Auth's update-consent with kledg:write removed.
      const consent = await consentOf(OWNER.id, clientId)
      const updated = await authRequest('/oauth2/update-consent', {
        method: 'POST',
        cookie,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: consent.id, update: { scopes: consent.scopes.filter((s) => s !== 'kledg:write') } }),
      })
      expect(updated.status).toBe(200)

      // The access token issued before still says kledg:write, but the consent no longer does.
      expect(scopesOfJwt(tokens.access_token)).toContain('kledg:write')
      const names = await toolNames(tokens.access_token)
      expect(names).toContain('list_companies')
      expect(names).not.toContain('create_draft_entry')

      // Refresh tokens were narrowed: new access tokens are read only.
      for (const stored of await refreshTokens(OWNER.id, clientId)) {
        expect(stored.scopes).not.toContain('kledg:write')
      }
      const refreshed = (await (await refresh(clientId, tokens.refresh_token!)).json()) as Tokens
      expect(scopesOfJwt(refreshed.access_token)).toEqual(['kledg:read'])

      // Asking for kledg:write again goes through the consent page (connect() accepts it there).
      const again = await connect(clientId, cookie)
      expect(scopesOfJwt(again.access_token).sort()).toEqual(['kledg:read', 'kledg:write'])
      expect(await toolNames(again.access_token)).toContain('create_draft_entry')
    })
  })

  describe('revocation', () => {
    it('deletes the refresh tokens and refuses an access token issued before, right away', async () => {
      const clientId = await registerClient()
      const cookie = await signIn(OWNER)
      const tokens = await connect(clientId, cookie)
      // Another user of the same assistant is not affected.
      const other = await connect(clientId, await signIn(OTHER))
      expect((await rpc(tokens.access_token, 'tools/list')).status).toBe(200)
      expect(await refreshTokens(OWNER.id, clientId)).toHaveLength(1)

      // What "Révoquer" does on the settings page.
      const consent = await consentOf(OWNER.id, clientId)
      const revoked = await authRequest('/oauth2/delete-consent', {
        method: 'POST',
        cookie,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: consent.id }),
      })
      expect(revoked.status).toBe(200)

      expect(await refreshTokens(OWNER.id, clientId)).toHaveLength(0)
      expect(await prisma.oauthAccessToken.count({ where: { userId: OWNER.id, clientId } })).toBe(0)
      expect(await prisma.aiAccessGrant.count({ where: { userId: OWNER.id, clientId } })).toBe(0)

      // The JWT has not expired, but /api/mcp refuses it and asks for a new authorization.
      const refused = await rpc(tokens.access_token, 'tools/list')
      expect(refused.status).toBe(401)
      expect(refused.headers.get('www-authenticate')).toContain('error="invalid_token"')
      expect(refused.headers.get('www-authenticate')).toContain(
        'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"',
      )
      expect((await refresh(clientId, tokens.refresh_token!)).status).toBe(400)

      expect(await refreshTokens(OTHER.id, clientId)).toHaveLength(1)
      expect((await rpc(other.access_token, 'tools/list')).status).toBe(200)
    })

    it("does not let a user revoke or lower another user's assistant", async () => {
      const clientId = await registerClient()
      const tokens = await connect(clientId, await signIn(OWNER))
      const consent = await consentOf(OWNER.id, clientId)
      const otherCookie = await signIn(OTHER)

      for (const [path, body] of [
        ['/oauth2/delete-consent', { id: consent.id }],
        ['/oauth2/update-consent', { id: consent.id, update: { scopes: ['kledg:read'] } }],
      ] as const) {
        const response = await authRequest(path, {
          method: 'POST',
          cookie: otherCookie,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        expect(response.status, path).toBeGreaterThanOrEqual(400)
      }
      expect((await consentOf(OWNER.id, clientId)).scopes).toContain('kledg:write')
      expect(await refreshTokens(OWNER.id, clientId)).toHaveLength(1)
      expect(await toolNames(tokens.access_token)).toContain('create_draft_entry')
    })

    it('answers 401 when signed out or without a token', async () => {
      const clientId = await registerClient()
      await connect(clientId, await signIn(OWNER))
      const consent = await consentOf(OWNER.id, clientId)
      for (const [path, body] of [
        ['/oauth2/delete-consent', { id: consent.id }],
        ['/oauth2/update-consent', { id: consent.id, update: { scopes: ['kledg:read'] } }],
      ] as const) {
        const response = await authRequest(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        expect(response.status, path).toBe(401)
      }
      expect(await refreshTokens(OWNER.id, clientId)).toHaveLength(1)

      const anonymous = await mcp.POST(
        new Request(MCP_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }),
      )
      expect(anonymous.status).toBe(401)
    })
  })
})
