/**
 * Bank connection routes against PostgreSQL (lib/__tests__/helpers/test-db.ts),
 * with the session and the bank APIs mocked (no network):
 * - roles: viewers and accountants cannot connect banks or add accounts,
 *   non-members get 404, anonymous users 401;
 * - Revolut OAuth callback: the state is bound to the company, the user
 *   and the browser cookie, used once, and the redirect stays on the instance;
 * - Ponto manual refresh: the user's IP is sent, once per 5 minutes;
 * - manual accounts: IBAN and 512 ledger account checked, several
 *   connections (Qonto, Revolut, manual) coexist in one company;
 * - the sync prefers the direct connection for an IBAN also seen via Ponto.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest, type NextResponse } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('bank_connections')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'https://kledg.example.com'
  process.env.RATE_LIMIT_DISABLED = 'true'
  // Behind one reverse proxy: the client IP is the last X-Forwarded-For address (lib/client-ip.ts).
  process.env.TRUST_PROXY_HOPS = '1'
  process.env.REVOLUT_ENVIRONMENT = 'sandbox'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { ACCOUNT_ID as PONTO_ACCOUNT, accountsPage, institutionsPage, transactionsPage, transaction } from './fixtures/ponto'
import { ACCOUNT_EUR, accounts as revolutAccounts, bankDetailsEur, cardPayment } from './fixtures/revolut'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
const routes: Record<string, Record<string, Handler>> = {}

const USERS = {
  companyAdmin: { id: 'u-cadmin', email: 'cadmin@test.local', name: 'Company admin', role: 'user' },
  otherAdmin: { id: 'u-cadmin-2', email: 'cadmin2@test.local', name: 'Other company admin', role: 'user' },
  accountant: { id: 'u-accountant', email: 'accountant@test.local', name: 'Accountant', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' },
  memberB: { id: 'u-member-b', email: 'b@test.local', name: 'Member of B', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const ids = {} as Record<string, string>
const PONTO_IBAN = 'FR7630004000031234567890143'

async function seed() {
  const { sealCredentials } = await import('@/lib/banking/credentials')
  const { getEncryptionKey } = await import('@/lib/crypto/encryption-key')
  const key = getEncryptionKey()!
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name ?? '', role: user.role } })
  }
  for (const [prefix, name, slug, siren] of [
    ['a', 'Atelier Alpha', 'atelier-alpha', '111111111'],
    ['b', 'Bureau Beta', 'bureau-beta', '222222222'],
  ] as const) {
    const company = await prisma.company.create({ data: { name, slug, siren } })
    await prisma.organization.create({ data: { id: `org-${prefix}`, name, slug: `org-${slug}`, createdAt: new Date(), companyId: company.id } })
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
    })
    await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque' } })
    await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512100', label: 'Banque 2' } })
    // Qonto direct, with the same IBAN as the Ponto account seeded below for A
    const qonto = await prisma.integration.create({
      data: { companyId: company.id, provider: 'QONTO', type: 'BANKING', name: 'Qonto', credentials: { login: 'l' }, credentialsEncrypted: false },
    })
    const qontoConnection = await prisma.bankConnection.create({
      data: { companyId: company.id, provider: 'QONTO', integrationId: qonto.id },
    })
    const qontoAccount = await prisma.bankAccount.create({
      data: { bankConnectionId: qontoConnection.id, externalAccountId: prefix === 'a' ? PONTO_IBAN : `ext-${prefix}`, iban: prefix === 'a' ? PONTO_IBAN : null, name: 'Compte Qonto' },
    })
    const ponto = await prisma.integration.create({
      data: {
        companyId: company.id,
        provider: 'PONTO',
        type: 'BANKING',
        name: 'Ponto',
        status: 'active',
        credentials: sealCredentials('PONTO', { clientId: 'ponto-client', clientSecret: 'ponto-secret-never-returned' }, key) as object,
        credentialsEncrypted: true,
        featureConfigs: { create: [{ feature: 'BANKING_ACCOUNTS' }, { feature: 'BANKING_TRANSACTIONS' }] },
      },
    })
    const pontoConnection = await prisma.bankConnection.create({
      data: { companyId: company.id, provider: 'PONTO', integrationId: ponto.id },
    })
    Object.assign(ids, {
      [`${prefix}Company`]: company.id,
      [`${prefix}QontoConnection`]: qontoConnection.id,
      [`${prefix}QontoAccount`]: qontoAccount.id,
      [`${prefix}PontoConnection`]: pontoConnection.id,
      [`${prefix}PontoIntegration`]: ponto.id,
    })
  }
  const members: Array<[string, string, string]> = [
    ['u-cadmin', 'org-a', 'companyAdmin'],
    ['u-cadmin-2', 'org-a', 'companyAdmin'],
    ['u-accountant', 'org-a', 'accountant'],
    ['u-viewer', 'org-a', 'viewer'],
    ['u-member-b', 'org-b', 'companyAdmin'],
  ]
  for (const [userId, organizationId, role] of members) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }
}

/** Bank APIs answered from fixtures; every outbound call is recorded. */
const outbound: Array<{ url: string; init?: RequestInit }> = []
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
function fakeBanks() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      outbound.push({ url: url.toString(), init })
      if (url.host === 'sandbox-b2b.revolut.com') {
        if (url.pathname.endsWith('/auth/token')) {
          return json({ access_token: 'oa_sand_access', token_type: 'bearer', expires_in: 2399, refresh_token: 'oa_sand_refresh_secret' })
        }
        if (url.pathname.endsWith('/accounts')) return json(revolutAccounts)
        if (url.pathname.endsWith(`/accounts/${ACCOUNT_EUR}/bank-details`)) return json(bankDetailsEur)
        if (url.pathname.endsWith('/transactions')) {
          return json([cardPayment('r1', '2026-10-01T10:00:00.000Z', -12), cardPayment('r2', '2026-10-01T11:00:00.000Z', -5, 'pending')])
        }
      }
      if (url.host === 'api.myponto.com') {
        if (url.pathname === '/oauth2/token') return json({ access_token: 'ponto_access', expires_in: 1799, token_type: 'bearer' })
        if (url.pathname === '/accounts') return json(accountsPage)
        if (url.pathname.endsWith('/transactions')) return json(transactionsPage([transaction('p1', new Date().toISOString(), 10)]))
        if (url.pathname === '/synchronizations') return json({ data: { id: 's', type: 'synchronization', attributes: { status: 'pending' } } }, 201)
        if (url.pathname === '/financial-institutions') return json(institutionsPage)
      }
      return json({ message: 'unexpected call' }, 500)
    }),
  )
}

const ROUTE_MODULES = {
  ponto: () => import('@/app/api/banking/ponto/route'),
  institutions: () => import('@/app/api/banking/institutions/route'),
  revolut: () => import('@/app/api/banking/revolut/route'),
  authorize: () => import('@/app/api/banking/revolut/authorize/route'),
  callback: () => import('@/app/api/banking/revolut/callback/route'),
  manual: () => import('@/app/api/banking/manual-accounts/route'),
  connection: () => import('@/app/api/banking/connections/[id]/route'),
  refresh: () => import('@/app/api/banking/connections/[id]/refresh/route'),
  connections: () => import('@/app/api/banking/connections/route'),
  account: () => import('@/app/api/banking/accounts/[id]/route'),
  accounts: () => import('@/app/api/banking/accounts/route'),
  selectAccount: () => import('@/app/api/banking/select-account/route'),
}

interface Call {
  route: keyof typeof ROUTE_MODULES
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: () => string
  params?: () => Record<string, string>
  body?: () => unknown
  headers?: Record<string, string>
}

async function call(who: Who, c: Call): Promise<Response> {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  const handler = routes[c.route][c.method]
  const body = c.body?.()
  const request = new NextRequest(`https://kledg.example.com${c.path()}`, {
    method: c.method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...c.headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return handler(request, { params: Promise.resolve(c.params?.() ?? {}) })
}

const A = () => ids.aCompany
const VALID_IBAN = 'FR7610107001011234567890129'

/** Routes that connect or configure a bank: company admins only. */
const MANAGE: Array<[string, Call]> = [
  ['connect Ponto', { route: 'ponto', method: 'POST', path: () => '/api/banking/ponto', body: () => ({ companyId: A(), clientId: 'id', clientSecret: 'secret' }) }],
  ['generate Revolut certificate', { route: 'revolut', method: 'POST', path: () => '/api/banking/revolut', body: () => ({ companyId: A() }) }],
  ['read Revolut setup', { route: 'revolut', method: 'GET', path: () => `/api/banking/revolut?companyId=${A()}` }],
  ['start Revolut consent', { route: 'authorize', method: 'POST', path: () => '/api/banking/revolut/authorize', body: () => ({ companyId: A(), clientId: 'client-abc12345' }) }],
  ['add manual account', { route: 'manual', method: 'POST', path: () => '/api/banking/manual-accounts', body: () => ({ companyId: A(), name: 'BoursoBank', iban: VALID_IBAN, ledgerAccountCode: '512100' }) }],
  ['disconnect bank', { route: 'connection', method: 'DELETE', path: () => `/api/banking/connections/${ids.aQontoConnection}`, params: () => ({ id: ids.aQontoConnection }) }],
  ['map ledger account', { route: 'account', method: 'PUT', path: () => `/api/banking/accounts/${ids.aQontoAccount}`, params: () => ({ id: ids.aQontoAccount }), body: () => ({ ledgerAccountCode: '512100' }) }],
]

const REFRESH: Call = {
  route: 'refresh',
  method: 'POST',
  path: () => `/api/banking/connections/${ids.aPontoConnection}/refresh`,
  params: () => ({ id: ids.aPontoConnection }),
  headers: { 'x-forwarded-for': '198.51.100.66, 203.0.113.7' },
}

describe.skipIf(!available)('bank connection routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('bank_connections')
    ;({ prisma } = await import('@/lib/prisma'))
    for (const [name, load] of Object.entries(ROUTE_MODULES)) {
      routes[name] = (await load()) as unknown as Record<string, Handler>
    }
  }, 60_000)

  const reseed = async () => {
    await prepareTestDatabase('bank_connections')
    await seed()
    outbound.length = 0
    fakeBanks()
    const { clearInstitutionsCache } = await import('@/lib/banking/ponto-connection.service')
    clearInstitutionsCache()
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('roles', () => {
    it.each(MANAGE)('viewer cannot %s (403)', async (_label, c) => {
      await reseed()
      expect((await call('viewer', c)).status).toBe(403)
    })

    it.each(MANAGE)('accountant cannot %s (403)', async (_label, c) => {
      await reseed()
      expect((await call('accountant', c)).status).toBe(403)
    })

    it.each(MANAGE)('a member of another company gets 404 on %s', async (_label, c) => {
      await reseed()
      expect((await call('memberB', c)).status).toBe(404)
    })

    it.each(MANAGE)('anonymous gets 401 on %s', async (_label, c) => {
      await reseed()
      expect((await call('anonymous', c)).status).toBe(401)
    })

    it('lets viewers read the bank list and connections, without secrets', async () => {
      await reseed()
      const institutions = await call('viewer', { route: 'institutions', method: 'GET', path: () => `/api/banking/institutions?companyId=${A()}` })
      expect(institutions.status).toBe(200)
      const { institutions: list } = (await institutions.json()) as { institutions: Array<{ name: string }> }
      expect(list.map((i) => i.name)).toEqual(['BNP Paribas - Ma Banque Entreprise'])
      const connections = await call('viewer', { route: 'connections', method: 'GET', path: () => `/api/banking/connections?companyId=${A()}` })
      expect(connections.status).toBe(200)
      const text = await connections.text()
      expect(text).not.toContain('ponto-secret-never-returned')
      expect(text).not.toContain('secretKeyEncrypted')
      expect(text).not.toContain('credentials')
    })

    it('viewer cannot refresh (403), member of B gets 404', async () => {
      await reseed()
      expect((await call('viewer', REFRESH)).status).toBe(403)
      expect((await call('memberB', REFRESH)).status).toBe(404)
    })
  })

  describe('Revolut OAuth callback', () => {
    async function startConsent(who: Who = 'companyAdmin') {
      expect((await call(who, MANAGE[1][1])).status).toBe(200)
      const response = await call(who, MANAGE[3][1])
      expect(response.status).toBe(200)
      const { url } = (await response.json()) as { url: string }
      const cookie = (response as NextResponse).cookies.get('kledg_revolut_oauth')
      return { url: new URL(url), cookie: cookie?.value ?? '', cookieOptions: cookie }
    }

    const callback = (query: string, cookie?: string): Call => ({
      route: 'callback',
      method: 'GET',
      path: () => `/api/banking/revolut/callback?${query}`,
      headers: cookie ? { cookie: `kledg_revolut_oauth=${cookie}` } : {},
    })

    it('builds the consent URL and an HttpOnly state cookie limited to the callback', async () => {
      await reseed()
      const { url, cookie, cookieOptions } = await startConsent()
      expect(url.origin + url.pathname).toBe('https://sandbox-business.revolut.com/app-confirm')
      expect(url.searchParams.get('client_id')).toBe('client-abc12345')
      expect(url.searchParams.get('redirect_uri')).toBe('https://kledg.example.com/api/banking/revolut/callback')
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('scope')).toBe('READ')
      expect(url.searchParams.get('state')).toBe(cookie)
      expect(cookieOptions).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/api/banking/revolut/callback' })
      // The setup never returns the private key
      const setup = await call('companyAdmin', MANAGE[2][1])
      const text = await setup.text()
      expect(text).toContain('BEGIN CERTIFICATE')
      expect(text).not.toContain('PRIVATE KEY')
    })

    it('connects, stores the refresh token encrypted and redirects to the instance only', async () => {
      await reseed()
      const { cookie } = await startConsent()
      const response = await call('companyAdmin', callback(`code=oa_sand_code&state=${encodeURIComponent(cookie)}`, cookie))
      expect(response.status).toBe(303)
      const location = new URL(response.headers.get('location')!)
      expect(location.origin).toBe('https://kledg.example.com')
      expect(location.pathname).toBe(`/${A()}/banking/connect/revolut`)
      expect(location.searchParams.get('status')).toBe('connected')

      const integration = await prisma.integration.findFirstOrThrow({ where: { companyId: A(), provider: 'REVOLUT' } })
      expect(integration.status).toBe('active')
      const stored = JSON.stringify(integration.credentials)
      expect(stored).not.toContain('oa_sand_refresh_secret')
      expect(stored).not.toContain('PRIVATE KEY')
      expect(integration.metadata).toEqual({})

      const token = outbound.find((c) => c.url.endsWith('/auth/token'))!
      const body = new URLSearchParams(String(token.init?.body))
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('oa_sand_code')

      // First sync: the EUR account, only the completed transaction
      const account = await prisma.bankAccount.findFirstOrThrow({ where: { externalAccountId: ACCOUNT_EUR } })
      expect(account.iban).toBe('LT123250000000000001')
      const lines = await prisma.bankTransaction.findMany({ where: { bankAccountId: account.id } })
      expect(lines.map((l) => l.externalTransactionId)).toEqual(['r1:r1-leg'])
      // Qonto, Ponto and Revolut connections coexist
      expect(await prisma.bankConnection.count({ where: { companyId: A() } })).toBe(3)
    })

    it('works when Revolut does not echo the state (cookie only)', async () => {
      await reseed()
      const { cookie } = await startConsent()
      const response = await call('companyAdmin', callback('code=oa_sand_code', cookie))
      expect(response.status).toBe(303)
    })

    it('refuses a state used from another browser (no cookie): CSRF', async () => {
      await reseed()
      const { cookie } = await startConsent()
      const response = await call('companyAdmin', callback(`code=oa_sand_code&state=${encodeURIComponent(cookie)}`))
      expect(response.status).toBe(403)
      expect(outbound.some((c) => c.url.endsWith('/auth/token'))).toBe(false)
    })

    it('refuses the state of another user of the same company', async () => {
      await reseed()
      const { cookie } = await startConsent('companyAdmin')
      const response = await call('otherAdmin', callback(`code=oa_sand_code&state=${encodeURIComponent(cookie)}`, cookie))
      expect(response.status).toBe(403)
    })

    it('refuses a state that does not match the cookie, an expired one, and a reused one', async () => {
      await reseed()
      const { cookie } = await startConsent()
      const forged = `${cookie.split('.')[0]}.forged`
      expect((await call('companyAdmin', callback(`code=c&state=${encodeURIComponent(forged)}`, cookie))).status).toBe(403)
      expect((await call('companyAdmin', callback('code=c', forged))).status).toBe(403)

      const ok = await call('companyAdmin', callback('code=c', cookie))
      expect(ok.status).toBe(303)
      expect((await call('companyAdmin', callback('code=c', cookie))).status).toBe(403)

      const again = await startConsent()
      await prisma.integration.updateMany({
        where: { companyId: A(), provider: 'REVOLUT' },
        data: { metadata: { oauth: { stateHash: 'x', userId: USERS.companyAdmin.id, expiresAt: '2020-01-01T00:00:00.000Z' } } },
      })
      expect((await call('companyAdmin', callback('code=c', again.cookie))).status).toBe(403)
    })

    it('sends the browser back with status=error when Revolut refuses the code, without its detail', async () => {
      await reseed()
      const { cookie } = await startConsent()
      const detail = 'Authorization code has expired (request 7f3e-revolut-internal)'
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: detail }), { status: 400 })),
      )
      const response = await call('companyAdmin', callback(`code=expired&state=${encodeURIComponent(cookie)}`, cookie))
      expect(response.status).toBe(303)
      const location = new URL(response.headers.get('location')!)
      expect(location.origin).toBe('https://kledg.example.com')
      expect(location.searchParams.get('status')).toBe('error')
      expect(response.headers.get('location')).not.toContain('expired')
      expect(await response.text()).not.toContain(detail)
      const integration = await prisma.integration.findFirstOrThrow({ where: { companyId: A(), provider: 'REVOLUT' } })
      expect(integration.status).not.toBe('active')
    })

    it('sends the browser back with status=denied when the user declines, and refuses an oversized code', async () => {
      await reseed()
      const { cookie } = await startConsent()
      const declined = await call('companyAdmin', callback('error=access_denied', cookie))
      expect(declined.status).toBe(303)
      expect(new URL(declined.headers.get('location')!).searchParams.get('status')).toBe('denied')
      const oversized = await call('companyAdmin', callback(`code=${'x'.repeat(513)}`, cookie))
      expect(oversized.status).toBe(400)
      expect(outbound.some((c) => c.url.endsWith('/auth/token'))).toBe(false)
    })

    it('answers 404 to a member of another company, 403 to a viewer', async () => {
      await reseed()
      const { cookie } = await startConsent()
      expect((await call('memberB', callback('code=c', cookie))).status).toBe(404)
      expect((await call('viewer', callback('code=c', cookie))).status).toBe(403)
      expect((await call('anonymous', callback('code=c', cookie))).status).toBe(401)
    })
  })

  describe('account lists and selection', () => {
    const select = (accountId: unknown): Call => ({
      route: 'selectAccount',
      method: 'POST',
      path: () => '/api/banking/select-account',
      body: () => ({ companyId: A(), accountId }),
    })

    it('lists the bank accounts of every connection of the company only, without secrets', async () => {
      await reseed()
      const response = await call('viewer', { route: 'accounts', method: 'GET', path: () => `/api/banking/accounts?companyId=${A()}` })
      expect(response.status).toBe(200)
      const text = await response.text()
      const { accounts } = JSON.parse(text) as { accounts: Array<{ id: string; bankConnection: { provider: string } }> }
      expect(accounts.map((a) => a.id)).toEqual([ids.aQontoAccount])
      expect(accounts[0].bankConnection.provider).toBe('QONTO')
      expect(text).not.toContain('ponto-secret-never-returned')
      expect(text).not.toContain('credentials')
    })

    it('selects an account of the company by id or IBAN on its own connection and clears the others', async () => {
      await reseed()
      await prisma.bankConnection.update({ where: { id: ids.aPontoConnection }, data: { selectedAccountId: ids.aQontoAccount } })
      const response = await call('companyAdmin', select(PONTO_IBAN))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        success: true,
        selectedAccountId: ids.aQontoAccount,
        selectedAccount: { id: ids.aQontoAccount, iban: PONTO_IBAN, name: 'Compte Qonto' },
      })
      const connections = await prisma.bankConnection.findMany({ where: { companyId: A() }, select: { id: true, selectedAccountId: true } })
      expect(Object.fromEntries(connections.map((c) => [c.id, c.selectedAccountId]))).toEqual({
        [ids.aQontoConnection]: ids.aQontoAccount,
        [ids.aPontoConnection]: null,
      })

      const cleared = await call('companyAdmin', select(null))
      expect(await cleared.json()).toEqual({ success: true, selectedAccountId: null, selectedAccount: null })
      expect(await prisma.bankConnection.count({ where: { companyId: A(), selectedAccountId: { not: null } } })).toBe(0)
    })

    it('refuses an account of another company and an invalid body, in French', async () => {
      await reseed()
      const foreign = await call('companyAdmin', select(ids.bQontoAccount))
      expect(foreign.status).toBe(400)
      expect(((await foreign.json()) as { error: string }).error).toBe("Ce compte bancaire n'appartient à aucune connexion de la société.")
      expect((await call('companyAdmin', select(42))).status).toBe(400)
      expect(await prisma.bankConnection.count({ where: { selectedAccountId: { not: null } } })).toBe(0)
    })

    it('answers 404 in French when the company has no bank connection', async () => {
      await reseed()
      await prisma.bankConnection.deleteMany({ where: { companyId: A() } })
      const response = await call('companyAdmin', select(null))
      expect(response.status).toBe(404)
      expect(((await response.json()) as { error: string }).error).toMatch(/^Aucune banque n'est connectée/)
    })
  })

  describe('Ponto refresh', () => {
    it('sends the user IP to Ponto, then refuses a second refresh within 5 minutes', async () => {
      await reseed()
      const first = await call('accountant', REFRESH)
      expect(first.status).toBe(200)
      const syncs = outbound.filter((c) => c.url.endsWith('/synchronizations')).map((c) => JSON.parse(String(c.init?.body)))
      expect(syncs.length).toBeGreaterThan(0)
      expect(syncs.every((s) => s.data.attributes.customerIpAddress === '203.0.113.7')).toBe(true)

      const second = await call('accountant', REFRESH)
      expect(second.status).toBe(429)
      expect(((await second.json()) as { error: string }).error).toMatch(/5 minutes/)

      await prisma.bankConnection.update({ where: { id: ids.aPontoConnection }, data: { lastManualSyncAt: new Date(Date.now() - 6 * 60_000) } })
      expect((await call('accountant', REFRESH)).status).toBe(200)
    })

    it('prefers Qonto direct for the IBAN Ponto also reaches', async () => {
      await reseed()
      expect((await call('accountant', REFRESH)).status).toBe(200)
      const pontoAccount = await prisma.bankAccount.findFirstOrThrow({ where: { externalAccountId: PONTO_ACCOUNT } })
      expect(pontoAccount.supersededById).toBe(ids.aQontoAccount)
      expect(pontoAccount.shouldSync).toBe(false)
      expect(await prisma.bankTransaction.count({ where: { bankAccountId: pontoAccount.id } })).toBe(0)
      // Its consent expiry is not counted on the connection (superseded)
      const connection = await prisma.bankConnection.findUniqueOrThrow({ where: { id: ids.aPontoConnection } })
      expect(connection.consentExpiresAt).toBeNull()
    })
  })

  describe('manual accounts and ledger mapping', () => {
    it('creates a manual account next to the API connections', async () => {
      await reseed()
      const response = await call('companyAdmin', MANAGE[4][1])
      expect(response.status).toBe(201)
      const { account } = (await response.json()) as { account: { id: string; iban: string; ledgerAccountCode: string } }
      expect(account).toMatchObject({ iban: VALID_IBAN, ledgerAccountCode: '512100' })
      const connection = await prisma.bankConnection.findFirstOrThrow({ where: { companyId: A(), provider: 'MANUAL' } })
      expect(connection.integrationId).toBeNull()
      // Same IBAN twice: conflict
      expect((await call('companyAdmin', MANAGE[4][1])).status).toBe(409)
      // Without IBAN, a second manual account in the same connection
      const second = await call('companyAdmin', { ...MANAGE[4][1], body: () => ({ companyId: A(), name: 'Shine', ledgerAccountCode: '512000' }) })
      expect(second.status).toBe(201)
      expect(await prisma.bankConnection.count({ where: { companyId: A(), provider: 'MANUAL' } })).toBe(1)
    })

    it('rejects an invalid IBAN and a ledger account outside 512 or missing', async () => {
      await reseed()
      const bad = (body: Record<string, unknown>) => call('companyAdmin', { ...MANAGE[4][1], body: () => ({ companyId: A(), name: 'X', ...body }) })
      expect((await bad({ iban: 'FR7610107001011234567890128', ledgerAccountCode: '512000' })).status).toBe(400)
      expect((await bad({ ledgerAccountCode: '401000' })).status).toBe(400)
      expect((await bad({ ledgerAccountCode: '512999' })).status).toBe(400)
    })

    it('maps a bank account to a 512 account without touching its display name', async () => {
      await reseed()
      await prisma.bankAccount.update({ where: { id: ids.aQontoAccount }, data: { displayName: 'Pro' } })
      expect((await call('companyAdmin', MANAGE[6][1])).status).toBe(200)
      const account = await prisma.bankAccount.findUniqueOrThrow({ where: { id: ids.aQontoAccount } })
      expect(account).toMatchObject({ ledgerAccountCode: '512100', displayName: 'Pro' })
    })

    it('disconnects a bank but keeps its accounts', async () => {
      await reseed()
      expect((await call('companyAdmin', MANAGE[5][1])).status).toBe(204)
      const connection = await prisma.bankConnection.findUniqueOrThrow({ where: { id: ids.aQontoConnection } })
      expect(connection).toMatchObject({ status: 'inactive', integrationId: null })
      expect(await prisma.bankAccount.count({ where: { bankConnectionId: connection.id } })).toBe(1)
      expect(await prisma.integration.count({ where: { companyId: A(), provider: 'QONTO' } })).toBe(0)
    })
  })
})
