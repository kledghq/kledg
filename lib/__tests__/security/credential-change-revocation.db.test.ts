/**
 * Round 3 AUTH regressions (pentest round 3, fixed):
 *
 * - KLEDG-R3-AUTH-01: a password reset or change evicts whoever held the
 *   session or knew the old password, API keys and AI assistants included
 *   (lib/account/revoke-delegated-access.ts, the list shared with
 *   KLEDG-SEC-011); a full control key needs the password typed again; a key
 *   that writes always expires (30, 90 or 365 days, 90 by default), its
 *   lifetime cannot be changed afterwards, and the owner gets an email
 *   (without the secret) for every new key.
 * - KLEDG-R3-AUTH-02: an email change confirmation link does not sign in
 *   whoever opens it; it completes only in the account's own browser.
 * - KLEDG-R3-AUTH-03: the email change answer does not wait for an email,
 *   so a free address and a registered one answer alike.
 *
 * Real Better Auth (HTTP handler in process), real /api/mcp, real Kledg
 * account routes; only getCurrentUser of the Kledg routes reads the cookie
 * of the browser under test, and emails are captured.
 *
 * Skipped when the test database server is unreachable.
 */

import { createHash, randomBytes } from 'crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('credential_change')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return {
    cookie: '',
    mails: [] as Array<{ to: string; subject?: string; text?: string; html?: string }>,
    mailDelayMs: 0,
    /** Deliveries that never finish (timing test): the request must not wait for them. */
    hang: false,
  }
})

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (message: { to: string; subject?: string; text?: string; html?: string }) => {
    state.mails.push(message)
    if (state.hang) await new Promise(() => {})
    if (state.mailDelayMs) await new Promise((resolve) => setTimeout(resolve, state.mailDelayMs))
  }),
  isEmailEnabled: async () => true,
}))
// getCurrentUser (lib/session.ts) reads the request headers: the cookie of the browser under test.
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: state.cookie }) }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const BASE = 'http://localhost:3000'
const MCP_URL = `${BASE}/api/mcp`
const REDIRECT_URI = 'https://assistant.attacker.test/callback'
const ALL_SCOPES = 'openid offline_access kledg:read kledg:write kledg:admin'

type Handler = (request: Request) => Promise<Response>

let prisma: typeof import('@/lib/prisma').prisma
let auth: typeof import('@/lib/auth').auth
let mcp: Record<'POST', Handler>

const VICTIM = { id: 'u-victim', email: 'victim@test.local', name: 'Victim' }
const ATTACKER = { id: 'u-attacker', email: 'attacker@test.local', name: 'Attacker' }
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

async function signIn(email: string, password = PASSWORD): Promise<string> {
  const response = await authRequest('/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(response.status).toBe(200)
  return cookieHeader(response)
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function locationOf(response: Response, body: unknown): string {
  const fromBody = body as { url?: string; redirect_uri?: string } | null
  const location = response.headers.get('location') ?? fromBody?.url ?? fromBody?.redirect_uri
  if (!location) throw new Error(`No redirect (${response.status}): ${JSON.stringify(body)}`)
  return location
}

async function registerClient(): Promise<string> {
  const response = await authRequest('/oauth2/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: ALL_SCOPES,
    }),
  })
  expect(response.status).toBeLessThan(300)
  return ((await response.json()) as { client_id: string }).client_id
}

/** Authorization code flow with PKCE, full control accepted on the consent page. */
async function connect(clientId: string, cookie: string): Promise<{ access_token: string; refresh_token: string }> {
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
      body: JSON.stringify({ accept: true, oauth_query: next.search.slice(1) }),
    })
    next = new URL(locationOf(consent, await readJson(consent)))
  }
  const code = next.searchParams.get('code')
  expect(code).toBeTruthy()
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
  expect(token.status).toBe(200)
  return (await token.json()) as { access_token: string; refresh_token: string }
}

async function refresh(clientId: string, refreshToken: string): Promise<Response> {
  return authRequest('/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource: MCP_URL }),
  })
}

async function mcpTools(credential: string, header: 'authorization' | 'x-api-key' = 'authorization'): Promise<{ status: number; names: string[] }> {
  const response = await mcp.POST(
    new Request(MCP_URL, {
      method: 'POST',
      headers: {
        [header]: header === 'authorization' ? `Bearer ${credential}` : credential,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  )
  const text = await response.text()
  if (response.status !== 200) return { status: response.status, names: [] }
  const json = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? 'null')
  const body = JSON.parse(json) as { result?: { tools?: Array<{ name: string }> } }
  return { status: 200, names: (body.result?.tools ?? []).map((t) => t.name) }
}

/** A Kledg route called from the browser holding `cookie` (getCurrentUser reads it). */
async function kledgRoute(
  modulePath: string,
  method: 'POST' | 'PUT',
  url: string,
  cookie: string,
  body: unknown,
): Promise<Response> {
  state.cookie = cookie
  const route = (await import(/* @vite-ignore */ modulePath)) as Record<string, (request: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>
  return route[method](
    new NextRequest(`${BASE}${url}`, {
      method,
      headers: { 'content-type': 'application/json', origin: BASE, 'sec-fetch-site': 'same-origin', cookie },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  )
}

async function seedUsers() {
  const ctx = await auth.$context
  const hash = await ctx.password.hash(PASSWORD)
  for (const user of [VICTIM, ATTACKER]) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: 'user', emailVerified: true } })
    await prisma.authAccount.create({
      data: { id: `acc-${user.id}`, accountId: user.id, providerId: 'credential', userId: user.id, password: hash },
    })
  }
}

describe.skipIf(!available)('round 3 AUTH regressions', () => {
  const realFetch = globalThis.fetch

  beforeAll(async () => {
    await prepareTestDatabase('credential_change')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as Record<'POST', Handler>
    await seedUsers()
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.startsWith(`${BASE}/api/auth/`)) return auth.handler(new Request(input, init))
      return realFetch(input, init)
    })
  }, 60_000)

  beforeEach(async () => {
    state.mails = []
    state.mailDelayMs = 0
    state.hang = false
    await prisma.oauthClient.deleteMany()
    await prisma.session.deleteMany()
    await prisma.aiAccessGrant.deleteMany()
    await prisma.apikey.deleteMany()
    const ctx = await auth.$context
    await prisma.authAccount.updateMany({ data: { password: await ctx.password.hash(PASSWORD) } })
    await prisma.user.update({ where: { id: ATTACKER.id }, data: { email: ATTACKER.email } })
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
  })

  async function createKey(cookie: string, password: string | null = PASSWORD): Promise<Response> {
    return kledgRoute('@/app/api/ai-access/api-keys/route', 'POST', '/api/ai-access/api-keys', cookie, {
      name: 'backup',
      access: { allCompanies: true, companyIds: [] },
      level: 'admin',
      ...(password !== null && { password }),
    })
  }

  /**
   * Whoever holds the victim's session (and password) for a moment: an API
   * key with full control and an OAuth assistant with full control and
   * offline_access, both on every company.
   */
  async function plantPersistence(stolenCookie: string) {
    const created = await createKey(stolenCookie)
    expect(created.status).toBe(201)
    const apiKey = ((await created.json()) as { key: string }).key

    const clientId = await registerClient()
    const grant = await kledgRoute('@/app/api/ai-access/assistants/route', 'PUT', '/api/ai-access/assistants', stolenCookie, {
      clientId,
      access: { allCompanies: true, companyIds: [] },
    })
    expect(grant.status).toBe(200)
    const tokens = await connect(clientId, stolenCookie)
    expect((await mcpTools(apiKey, 'x-api-key')).status).toBe(200)
    expect((await mcpTools(tokens.access_token)).status).toBe(200)
    return { apiKey, clientId, tokens }
  }

  async function expectEvicted(planted: Awaited<ReturnType<typeof plantPersistence>>) {
    expect((await mcpTools(planted.apiKey, 'x-api-key')).status).toBe(401)
    expect((await mcpTools(planted.tokens.access_token)).status).toBe(401)
    expect((await refresh(planted.clientId, planted.tokens.refresh_token)).status).toBe(400)
    expect(await prisma.apikey.count({ where: { referenceId: VICTIM.id } })).toBe(0)
    expect(await prisma.oauthConsent.count({ where: { userId: VICTIM.id } })).toBe(0)
    expect(await prisma.oauthAccessToken.count({ where: { userId: VICTIM.id } })).toBe(0)
    expect(await prisma.aiAccessGrant.count({ where: { userId: VICTIM.id } })).toBe(0)
  }

  it('[KLEDG-R3-AUTH-01] a password reset revokes API keys and AI assistants with the sessions', async () => {
    const planted = await plantPersistence(await signIn(VICTIM.email))
    // The attacker's key does not touch the other account.
    const other = await createKey(await signIn(ATTACKER.email))
    expect(other.status).toBe(201)

    const requested = await authRequest('/request-password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: VICTIM.email, redirectTo: '/reset-password' }),
    })
    expect(requested.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 50)) // the reset mail is sent after the response (waitUntil)
    const mail = state.mails.at(-1)
    const token = /reset-password\/([A-Za-z0-9_-]+)/.exec(`${mail?.text ?? ''} ${mail?.html ?? ''}`)?.[1]
    expect(token).toBeTruthy()
    const reset = await authRequest('/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: 'a brand new long password', token }),
    })
    expect(reset.status).toBe(200)

    expect(await prisma.session.count({ where: { userId: VICTIM.id } })).toBe(0)
    await expectEvicted(planted)
    expect(await prisma.apikey.count({ where: { referenceId: ATTACKER.id } })).toBe(1)

    // A key created afterwards, with the new password, works.
    const fresh = await createKey(await signIn(VICTIM.email, 'a brand new long password'), 'a brand new long password')
    expect(fresh.status).toBe(201)
    expect((await mcpTools(((await fresh.json()) as { key: string }).key, 'x-api-key')).status).toBe(200)
  })

  it('[KLEDG-R3-AUTH-01] a password change revokes them too and keeps the session that made it', async () => {
    const planted = await plantPersistence(await signIn(VICTIM.email))

    const mine = await signIn(VICTIM.email)
    const changed = await kledgRoute('@/app/api/account/password/route', 'POST', '/api/account/password', mine, {
      currentPassword: PASSWORD,
      newPassword: 'a brand new long password',
    })
    expect(changed.status).toBe(200)
    expect(await prisma.session.count({ where: { userId: VICTIM.id } })).toBe(1)
    await expectEvicted(planted)
  })

  it('[KLEDG-R3-AUTH-01] a refused password change revokes nothing', async () => {
    const planted = await plantPersistence(await signIn(VICTIM.email))
    const changed = await kledgRoute('@/app/api/account/password/route', 'POST', '/api/account/password', await signIn(VICTIM.email), {
      currentPassword: 'not the current password',
      newPassword: 'a brand new long password',
    })
    expect(changed.status).toBe(400)
    expect((await mcpTools(planted.apiKey, 'x-api-key')).status).toBe(200)
    expect((await mcpTools(planted.tokens.access_token)).status).toBe(200)
  })

  it('[KLEDG-R3-AUTH-01] a full control API key needs the password typed again', async () => {
    const cookie = await signIn(VICTIM.email)
    expect((await createKey(cookie, null)).status).toBe(400)
    expect((await createKey(cookie, 'not the current password')).status).toBe(400)
    expect(await prisma.apikey.count({ where: { referenceId: VICTIM.id } })).toBe(0)
    expect((await createKey(cookie)).status).toBe(201)
    // Read and drafts keys do not ask for it.
    const drafts = await kledgRoute('@/app/api/ai-access/api-keys/route', 'POST', '/api/ai-access/api-keys', cookie, {
      name: 'drafts',
      access: { allCompanies: true, companyIds: [] },
      level: 'write',
    })
    expect(drafts.status).toBe(201)
  })

  async function emailChangeLink(): Promise<string> {
    const attackerCookie = await signIn(ATTACKER.email)
    state.cookie = attackerCookie
    const { requestEmailChange } = await import('@/lib/account/change-email.service')
    await requestEmailChange(
      { id: ATTACKER.id, email: ATTACKER.email, name: ATTACKER.name, role: 'user' },
      new Headers({ cookie: attackerCookie }),
      { newEmail: 'attacker-2@test.local', password: PASSWORD },
    )
    const link = state.mails.find((m) => m.to === 'attacker-2@test.local')
    const url = /(http:\/\/localhost:3000\/api\/auth\/verify-email\?[^\s"<]+)/.exec(`${link?.text ?? ''}`)?.[1]
    expect(url).toBeTruthy()
    return url!.replace(/&amp;/g, '&')
  }

  function open(url: string, cookie?: string): Promise<Response> {
    const headers = new Headers({ origin: BASE })
    if (cookie) headers.set('cookie', cookie)
    return auth.handler(new Request(url, { headers }))
  }

  it('[KLEDG-R3-AUTH-02] an email change link does not sign in a signed out browser', async () => {
    const url = await emailChangeLink()
    const opened = await open(url)
    expect(opened.status).toBe(302)
    expect(cookieHeader(opened)).not.toContain('session_token')
    const location = new URL(opened.headers.get('location')!, BASE)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('error')).toBe('SIGN_IN_TO_CONFIRM_EMAIL')
    // Back to the same link once signed in.
    expect(`${BASE}${location.searchParams.get('redirect')}`).toBe(url)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ATTACKER.id } })).email).toBe(ATTACKER.email)
    expect(await prisma.session.count({ where: { userId: ATTACKER.id } })).toBe(1)
  })

  it('[KLEDG-R3-AUTH-02] the link completes in the account’s own browser and is refused in another account’s', async () => {
    const url = await emailChangeLink()
    const refused = await open(url, await signIn(VICTIM.email))
    expect(refused.status).toBe(302)
    expect(refused.headers.get('location')).toContain('error=INVALID_USER')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ATTACKER.id } })).email).toBe(ATTACKER.email)

    const own = await open(url, await signIn(ATTACKER.email))
    expect(own.status).toBe(302)
    expect(own.headers.get('location')).toBe('/settings/profile?email=confirmed')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ATTACKER.id } })).email).toBe('attacker-2@test.local')
  })

  it('[KLEDG-R3-AUTH-03] the email change answer does not wait for the delivery, free or registered address', async () => {
    const attackerCookie = await signIn(ATTACKER.email)
    state.cookie = attackerCookie
    const { requestEmailChange } = await import('@/lib/account/change-email.service')
    const me = { id: ATTACKER.id, email: ATTACKER.email, name: ATTACKER.name, role: 'user' }
    state.hang = true // a delivery that never finishes

    for (const newEmail of [VICTIM.email, 'nobody-here@test.local']) {
      const answer = requestEmailChange(me, new Headers({ cookie: attackerCookie }), { newEmail, password: PASSWORD })
      const result = await Promise.race([answer, new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 3_000))])
      expect(result).toEqual({ status: 'verification-sent' })
    }
    // The link to the free address was still sent; nothing to the registered one.
    expect(state.mails.some((m) => m.to === 'nobody-here@test.local')).toBe(true)
    expect(state.mails.some((m) => m.to === VICTIM.email)).toBe(false)
  })

  async function createKeyWith(cookie: string, body: Record<string, unknown>): Promise<Response> {
    return kledgRoute('@/app/api/ai-access/api-keys/route', 'POST', '/api/ai-access/api-keys', cookie, {
      name: 'cle',
      access: { allCompanies: true, companyIds: [] },
      ...body,
    })
  }

  it('[KLEDG-R3-AUTH-01] a key that writes expires (90 days by default); only a read-only key may not', async () => {
    const cookie = await signIn(VICTIM.email)
    const day = 24 * 3600 * 1000
    const expiresIn = async (response: Response) => {
      expect(response.status).toBe(201)
      const { expiresAt } = (await response.json()) as { expiresAt: string | null }
      return expiresAt === null ? null : Math.round((new Date(expiresAt).getTime() - Date.now()) / day)
    }
    expect(await expiresIn(await createKeyWith(cookie, { level: 'admin', password: PASSWORD }))).toBe(90)
    expect(await expiresIn(await createKeyWith(cookie, { level: 'write' }))).toBe(90)
    expect(await expiresIn(await createKeyWith(cookie, { level: 'write', expiresInDays: 365 }))).toBe(365)
    expect(await expiresIn(await createKeyWith(cookie, { level: 'read', expiresInDays: 30 }))).toBe(30)
    expect(await expiresIn(await createKeyWith(cookie, { level: 'read', expiresInDays: null }))).toBeNull()
    for (const level of ['write', 'admin']) {
      const refused = await createKeyWith(cookie, { level, expiresInDays: null, password: PASSWORD })
      expect(refused.status).toBe(400)
    }
    expect((await createKeyWith(cookie, { level: 'read', expiresInDays: 7 })).status).toBe(400)
  })

  it('[KLEDG-R3-AUTH-01] an expired key is refused, and its lifetime cannot be changed over HTTP', async () => {
    const cookie = await signIn(VICTIM.email)
    const created = await createKeyWith(cookie, { level: 'write', expiresInDays: 30 })
    const { id, key } = (await created.json()) as { id: string; key: string }
    const extended = await authRequest('/api-key/update', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyId: id, expiresIn: null }),
    })
    expect(extended.status).toBe(403)
    expect((await prisma.apikey.findUniqueOrThrow({ where: { id } })).expiresAt).not.toBeNull()
    expect((await mcpTools(key, 'x-api-key')).status).toBe(200)
    await prisma.apikey.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const { clearVerifiedApiKeys } = await import('@/lib/mcp/api-key')
    clearVerifiedApiKeys()
    expect((await mcpTools(key, 'x-api-key')).status).toBe(401)
  })

  it('[KLEDG-R3-AUTH-01] the owner gets an email for every new key, without its secret', async () => {
    const cookie = await signIn(VICTIM.email)
    const created = await createKeyWith(cookie, { name: 'Script compta', level: 'admin', password: PASSWORD })
    const { key } = (await created.json()) as { key: string }
    const notice = state.mails.find((m) => m.to === VICTIM.email && m.subject?.startsWith('Nouvelle clé API'))
    expect(notice).toBeTruthy()
    const text = `${notice?.text ?? ''} ${notice?.html ?? ''}`
    expect(text).toContain('Script compta')
    expect(text).toContain('Contrôle total')
    expect(text).toMatch(/expire le \d{2}\/\d{2}\/\d{4}/)
    expect(text).not.toContain(key)
    expect(text).not.toContain(key.slice(0, 12))
  })

  it('[KLEDG-R3-AUTH-01] migration 20261121100000 gives the existing keys that write an expiry', async () => {
    const base = { referenceId: VICTIM.id, key: 'hash', enabled: true, createdAt: new Date(), updatedAt: new Date() }
    const rows = [
      ['k-admin', JSON.stringify({ kledg: ['read', 'write', 'admin'] })],
      ['k-write', JSON.stringify({ kledg: ['read', 'write'] })],
      ['k-read', JSON.stringify({ kledg: ['read'] })],
      ['k-none', null],
      ['k-broken', '{not json'],
    ] as const
    for (const [id, permissions] of rows) await prisma.apikey.create({ data: { ...base, id, key: `hash-${id}`, permissions } as never })
    const { readFileSync } = await import('fs')
    const sql = readFileSync('prisma/migrations/20261121100000_api_key_expiry/migration.sql', 'utf8')
    await prisma.$executeRawUnsafe(sql)
    const expiry = async (id: string) => (await prisma.apikey.findUniqueOrThrow({ where: { id } })).expiresAt
    const day = 24 * 3600 * 1000
    for (const id of ['k-admin', 'k-write']) expect(Math.round(((await expiry(id))!.getTime() - Date.now()) / day)).toBe(90)
    for (const id of ['k-read', 'k-none', 'k-broken']) expect(await expiry(id)).toBeNull()
  })
})
