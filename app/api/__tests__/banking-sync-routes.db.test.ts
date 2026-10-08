/**
 * Bank routes that change what is synced, against PostgreSQL, with the
 * session mocked and the bank APIs answered by a stubbed fetch (no network):
 * - POST /api/banking/accounts/sync: accounts of a connection to synchronize;
 * - POST /api/banking/attachments/sync: Qonto receipts copied into
 *   attachments (lib/integrations/providers/qonto/sync-attachments.ts);
 * - POST /api/banking/ponto: Ponto connected, credentials stored encrypted
 *   (lib/banking/ponto-connection.service.ts connectPonto), first sync;
 * - GET /api/ai-actions: the user's own actions prepared by assistants.
 * Roles (403), other companies (404), anonymous (401), French 400s, and the
 * rows written.
 * Skipped when the test database server is unreachable.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_bank_sync_routes')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { accountsPage, institutionsPage, transaction, transactionsPage } from '@/lib/banking/__tests__/fixtures/ponto'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

let prisma: Prisma
let syncAccounts: Handler
let syncAttachments: Handler
let connectPontoRoute: Handler
let listAiActions: Handler
let syncQontoAttachments: typeof import('@/lib/integrations/providers/qonto/sync-attachments').syncQontoAttachments
let connectPonto: typeof import('@/lib/banking/ponto-connection.service').connectPonto

const USERS = {
  admin: { id: 'u-admin', email: 'admin@test.local', name: 'Admin A', role: 'user' },
  accountant: { id: 'u-accountant', email: 'accountant@test.local', name: 'Comptable A', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Lecteur A', role: 'user' },
  adminB: { id: 'u-admin-b', email: 'b@test.local', name: 'Admin B', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const ids = {} as Record<string, string>
const SECRET = 'qonto-secret-key-0123'
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  }
  for (const [prefix, name, slug, siren] of [
    ['a', 'Atelier Alpha', 'atelier-alpha', '111111111'],
    ['b', 'Bureau Beta', 'bureau-beta', '222222222'],
  ] as const) {
    const company = await prisma.company.create({ data: { name, slug, siren } })
    await prisma.organization.create({ data: { id: `org-${prefix}`, name, slug: `org-${slug}`, createdAt: new Date(), companyId: company.id } })
    const qonto = await prisma.integration.create({
      data: {
        companyId: company.id,
        provider: 'QONTO',
        type: 'BANKING',
        name: 'Qonto',
        status: 'active',
        credentials: { login: `acme-${prefix}`, secretKey: SECRET },
        credentialsEncrypted: false,
      },
    })
    const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'QONTO', integrationId: qonto.id } })
    ids[`${prefix}Company`] = company.id
    ids[`${prefix}Qonto`] = qonto.id
    ids[`${prefix}Connection`] = connection.id
  }
  const resource = await prisma.integrationResource.create({
    data: { integrationId: ids.aQonto, resourceType: 'bank_account', externalId: 'FR76-main', name: 'Principal', data: {} },
  })
  const main = await prisma.bankAccount.create({
    data: { bankConnectionId: ids.aConnection, externalAccountId: 'FR76-main', name: 'B Principal', integrationResourceId: resource.id },
  })
  const savings = await prisma.bankAccount.create({ data: { bankConnectionId: ids.aConnection, externalAccountId: 'FR76-savings', name: 'C Epargne' } })
  const superseded = await prisma.bankAccount.create({
    data: { bankConnectionId: ids.aConnection, externalAccountId: 'FR76-old', name: 'A Ancien', shouldSync: false, supersededById: main.id },
  })
  const accountB = await prisma.bankAccount.create({ data: { bankConnectionId: ids.bConnection, externalAccountId: 'FR76-b', name: 'Compte B' } })
  Object.assign(ids, { main: main.id, savings: savings.id, superseded: superseded.id, accountB: accountB.id, resource: resource.id })

  const members: Array<[string, string, string]> = [
    [USERS.admin.id, 'org-a', 'companyAdmin'],
    [USERS.accountant.id, 'org-a', 'accountant'],
    [USERS.viewer.id, 'org-a', 'viewer'],
    [USERS.adminB.id, 'org-b', 'companyAdmin'],
  ]
  for (const [userId, organizationId, role] of members) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }
}

async function call(who: Who, handler: Handler, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  const request = new NextRequest(`https://kledg.example.com${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const response = await handler(request, { params: Promise.resolve({}) })
  const text = await response.text()
  return { status: response.status, text, json: text ? (JSON.parse(text) as Record<string, unknown>) : null }
}

/** Bank API stub: every outbound URL is recorded; `answer` returns null for an unexpected call (500). */
const outbound: URL[] = []
function stubFetch(answer: (url: URL) => Response | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      outbound.push(url)
      return answer(url) ?? new Response(JSON.stringify({ message: 'unexpected call' }), { status: 500 })
    }),
  )
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe.skipIf(!available)('banking sync routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_bank_sync_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    syncAccounts = (await import('@/app/api/banking/accounts/sync/route')).POST as Handler
    syncAttachments = (await import('@/app/api/banking/attachments/sync/route')).POST as Handler
    connectPontoRoute = (await import('@/app/api/banking/ponto/route')).POST as Handler
    listAiActions = (await import('@/app/api/ai-actions/route')).GET as Handler
    ;({ syncQontoAttachments } = await import('@/lib/integrations/providers/qonto/sync-attachments'))
    ;({ connectPonto } = await import('@/lib/banking/ponto-connection.service'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('cov_bank_sync_routes')
    await seed()
    outbound.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('POST /api/banking/accounts/sync', () => {
    const shouldSync = async () =>
      Object.fromEntries(
        (await prisma.bankAccount.findMany({ select: { id: true, shouldSync: true } })).map((a) => [a.id, a.shouldSync]),
      )

    it('turns the listed accounts on and the others off, never a superseded one', async () => {
      const response = await call('admin', syncAccounts, 'POST', '/api/banking/accounts/sync', {
        bankConnectionId: ids.aConnection,
        accountIds: [ids.main, ids.superseded, ids.accountB],
      })
      expect(response.status).toBe(200)
      expect(response.json).toEqual({
        success: true,
        accounts: [
          { id: ids.superseded, name: 'A Ancien', displayName: null, iban: null, currency: 'EUR', shouldSync: false, supersededById: ids.main },
          { id: ids.main, name: 'B Principal', displayName: null, iban: null, currency: 'EUR', shouldSync: true, supersededById: null },
          { id: ids.savings, name: 'C Epargne', displayName: null, iban: null, currency: 'EUR', shouldSync: false, supersededById: null },
        ],
      })
      // The account of company B named in the body is left alone
      expect(await shouldSync()).toEqual({ [ids.main]: true, [ids.savings]: false, [ids.superseded]: false, [ids.accountB]: true })

      await call('admin', syncAccounts, 'POST', '/api/banking/accounts/sync', { bankConnectionId: ids.aConnection, accountIds: [ids.savings] })
      expect((await prisma.integrationResource.findUniqueOrThrow({ where: { id: ids.resource } })).shouldSync).toBe(false)
      expect(await shouldSync()).toMatchObject({ [ids.main]: false, [ids.savings]: true })
    })

    it('answers 400 in French without a connection or with invalid account ids', async () => {
      const missing = await call('admin', syncAccounts, 'POST', '/api/banking/accounts/sync', { accountIds: [ids.main] })
      expect(missing.status).toBe(400)
      expect(missing.json).toEqual({
        error: 'Précisez la connexion bancaire (bankConnectionId) et les comptes à synchroniser (accountIds).',
      })
      const notArray = await call('admin', syncAccounts, 'POST', '/api/banking/accounts/sync', { bankConnectionId: ids.aConnection, accountIds: ids.main })
      expect(notArray.status).toBe(400)
      expect(String(notArray.json?.error)).toContain('accountIds')
      expect(await prisma.bankAccount.count({ where: { shouldSync: false } })).toBe(1)
    })

    it('answers 404 for an unknown connection and for a connection of another company', async () => {
      const unknown = await call('admin', syncAccounts, 'POST', '/api/banking/accounts/sync', { bankConnectionId: 'nope', accountIds: [] })
      expect(unknown.status).toBe(404)
      expect(unknown.json).toEqual({ error: 'Connexion bancaire introuvable' })

      const other = await call('adminB', syncAccounts, 'POST', '/api/banking/accounts/sync', { bankConnectionId: ids.aConnection, accountIds: [] })
      expect(other.status).toBe(404)
      expect(await prisma.bankAccount.count({ where: { shouldSync: true } })).toBe(3)
    })

    it('refuses accountants and viewers (403) and anonymous users (401)', async () => {
      const body = { bankConnectionId: ids.aConnection, accountIds: [] }
      expect((await call('accountant', syncAccounts, 'POST', '/api/banking/accounts/sync', body)).status).toBe(403)
      expect((await call('viewer', syncAccounts, 'POST', '/api/banking/accounts/sync', body)).status).toBe(403)
      expect((await call('anonymous', syncAccounts, 'POST', '/api/banking/accounts/sync', body)).status).toBe(401)
      expect(await prisma.bankAccount.count({ where: { shouldSync: true } })).toBe(3)
    })
  })

  describe('POST /api/banking/attachments/sync', () => {
    const debit = (externalTransactionId: string, providerData?: object, side = 'debit', bankAccountId = ids.main) =>
      prisma.bankTransaction.create({
        data: { bankAccountId, externalTransactionId, amount: '12.50', side, date: new Date('2026-09-01T00:00:00Z'), providerData },
      })

    const attachment = (id: string, name: string) => ({
      id,
      file_name: name,
      file_size: '2048',
      file_content_type: 'application/pdf',
      url: `https://files.qonto.com/${id}.pdf`,
      created_at: '2026-09-01T10:00:00.000Z',
      probative_attachment: { status: 'available' },
    })

    /** Qonto answers per transaction uuid: three receipts, none, or a failure. */
    function stubReceipts(overrides: Record<string, () => Response> = {}) {
      stubFetch((url) => {
        const match = url.pathname.match(/\/transactions\/([^/]+)\/attachments$/)
        if (!match) return null
        const uuid = decodeURIComponent(match[1])
        if (overrides[uuid]) return overrides[uuid]()
        if (uuid === UUID(1)) {
          return json({ attachments: [attachment('qa-1', 'facture-1.pdf'), attachment('qa-2', 'facture-2.pdf'), attachment('qa-3', 'facture-3.pdf')], meta: {} })
        }
        if (uuid === UUID(2)) return json({ attachments: [], meta: {} })
        if (uuid === UUID(5)) return json({ errors: [{ detail: 'boom' }] }, 503)
        return null
      })
    }

    async function seedTransactions() {
      const tx1 = await debit('qonto-tx-1', { id: UUID(1) })
      await debit(UUID(2))
      await debit('qonto-credit', { id: UUID(3) }, 'credit')
      const full = await debit('qonto-tx-4', { id: UUID(4) })
      for (const n of [1, 2]) {
        await prisma.attachment.create({ data: { companyId: ids.aCompany, bankTransactionId: full.id, fileName: `deja-${n}.pdf` } })
      }
      await debit('qonto-tx-5', { id: UUID(5) })
      await debit('qonto-b', { id: UUID(9) }, 'debit', ids.accountB)
      return tx1
    }

    it('copies at most two receipts per Qonto debit and reports the transactions Qonto failed on', async () => {
      const tx1 = await seedTransactions()
      stubReceipts()
      const response = await call('accountant', syncAttachments, 'POST', '/api/banking/attachments/sync', { companyId: ids.aCompany })
      expect(response.status).toBe(200)
      expect(response.json).toEqual({
        success: true,
        created: 2,
        updated: 0,
        skipped: 1,
        totalProcessed: 3,
        rateLimitReached: false,
        errors: ["Les justificatifs de 1 transaction n'ont pas pu être lus chez Qonto."],
        message: 'Justificatifs synchronisés.',
      })
      // Credits, full transactions and company B are never asked about
      const asked = outbound.map((u) => decodeURIComponent(u.pathname.split('/')[3])).sort()
      expect(asked).toEqual([UUID(1), UUID(2), UUID(5)])
      expect(outbound.every((u) => u.host === 'thirdparty.qonto.com')).toBe(true)

      const stored = await prisma.attachment.findMany({
        where: { bankTransactionId: tx1.id },
        orderBy: { fileName: 'asc' },
        select: { companyId: true, integrationId: true, externalAttachmentId: true, transactionUuid: true, fileName: true, fileSize: true, fileContentType: true, fileUrl: true },
      })
      expect(stored).toEqual([
        { companyId: ids.aCompany, integrationId: ids.aQonto, externalAttachmentId: 'qa-1', transactionUuid: UUID(1), fileName: 'facture-1.pdf', fileSize: 2048, fileContentType: 'application/pdf', fileUrl: 'https://files.qonto.com/qa-1.pdf' },
        { companyId: ids.aCompany, integrationId: ids.aQonto, externalAttachmentId: 'qa-2', transactionUuid: UUID(1), fileName: 'facture-2.pdf', fileSize: 2048, fileContentType: 'application/pdf', fileUrl: 'https://files.qonto.com/qa-2.pdf' },
      ])
    })

    it('creates nothing twice when run again', async () => {
      await seedTransactions()
      stubReceipts()
      await syncQontoAttachments(ids.aCompany)
      const before = await prisma.attachment.count()
      // The transaction with two receipts is full now: only the others are asked again
      outbound.length = 0
      const again = await syncQontoAttachments(ids.aCompany)
      expect(again).toMatchObject({ created: 0, updated: 0, skipped: 1 })
      expect(await prisma.attachment.count()).toBe(before)
      expect(outbound.map((u) => decodeURIComponent(u.pathname.split('/')[3])).sort()).toEqual([UUID(2), UUID(5)])
    })

    it('refreshes a receipt already stored for a transaction with room left', async () => {
      const tx = await debit('qonto-tx-1', { id: UUID(1) })
      await prisma.attachment.create({
        data: { companyId: ids.aCompany, integrationId: ids.aQonto, externalAttachmentId: 'qa-1', fileName: 'ancien-nom.pdf', fileUrl: 'https://files.qonto.com/expired' },
      })
      stubReceipts({ [UUID(1)]: () => json({ attachments: [attachment('qa-1', 'facture-1.pdf')] }) })
      const result = await syncQontoAttachments(ids.aCompany)
      expect(result).toMatchObject({ created: 0, updated: 1, skipped: 0, success: true })
      const row = await prisma.attachment.findFirstOrThrow({ where: { externalAttachmentId: 'qa-1' } })
      expect(row).toMatchObject({ fileName: 'facture-1.pdf', fileUrl: 'https://files.qonto.com/qa-1.pdf', bankTransactionId: tx.id, transactionUuid: UUID(1) })
    })

    it('stops at a Qonto rate limit with a French message', async () => {
      await debit('qonto-tx-1', { id: UUID(1) })
      await debit('qonto-tx-2', { id: UUID(2) })
      stubReceipts({ [UUID(1)]: () => json({ message: 'Too many requests' }, 429) })
      const result = await syncQontoAttachments(ids.aCompany)
      const message = 'Qonto limite le nombre de requêtes : la synchronisation des justificatifs a été interrompue. Réessayez dans quelques minutes.'
      expect(result).toEqual({
        success: false,
        created: 0,
        updated: 0,
        skipped: 0,
        totalProcessed: 0,
        rateLimitReached: true,
        errors: [message],
        message,
      })
      expect(outbound).toHaveLength(1)
    })

    it('answers 404 in French when Qonto is not connected', async () => {
      await prisma.integration.update({ where: { id: ids.aQonto }, data: { status: 'inactive' } })
      stubReceipts()
      const response = await call('admin', syncAttachments, 'POST', '/api/banking/attachments/sync', { companyId: ids.aCompany })
      expect(response.status).toBe(404)
      expect(response.json).toEqual({ error: "Qonto n'est pas connecté pour cette société : connectez-le depuis la page Banque." })
      expect(outbound).toEqual([])
    })

    it('refuses a viewer (403), a member of another company (404) and an anonymous user (401)', async () => {
      await seedTransactions()
      stubReceipts()
      const body = { companyId: ids.aCompany }
      expect((await call('viewer', syncAttachments, 'POST', '/api/banking/attachments/sync', body)).status).toBe(403)
      expect((await call('adminB', syncAttachments, 'POST', '/api/banking/attachments/sync', body)).status).toBe(404)
      expect((await call('anonymous', syncAttachments, 'POST', '/api/banking/attachments/sync', body)).status).toBe(401)
      expect(outbound).toEqual([])
      expect(await prisma.attachment.count()).toBe(2)
    })
  })

  describe('POST /api/banking/ponto', () => {
    function stubPonto(options: { refuse?: boolean } = {}) {
      stubFetch((url) => {
        if (url.host !== 'api.myponto.com') return null
        if (url.pathname === '/oauth2/token') {
          return options.refuse
            ? json({ errors: [{ code: 'invalid_client', detail: 'Client authentication failed for ponto-client-xyz' }] }, 401)
            : json({ access_token: 'ponto_access', expires_in: 1799, token_type: 'bearer' })
        }
        if (url.pathname === '/accounts') return json(accountsPage)
        if (url.pathname.endsWith('/transactions')) return json(transactionsPage([transaction('p1', '2026-10-01T00:00:00.000Z', 250.4)]))
        if (url.pathname.startsWith('/financial-institutions/')) return json({ data: institutionsPage.data[0] })
        return null
      })
    }
    const body = () => ({ companyId: ids.aCompany, clientId: ' ponto-client ', clientSecret: 'ponto-secret-never-stored-clear' })

    it('connects Ponto: credentials sealed, accounts and transactions synced, audit written', async () => {
      stubPonto()
      const response = await call('admin', connectPontoRoute, 'POST', '/api/banking/ponto', body())
      expect(response.status).toBe(201)
      const integration = await prisma.integration.findFirstOrThrow({
        where: { companyId: ids.aCompany, provider: 'PONTO' },
        include: { featureConfigs: { select: { feature: true, enabled: true } } },
      })
      // One account: the deprecated one of the fixture is left out
      expect(response.json).toEqual({ integrationId: integration.id, accountsCount: 1, syncErrors: 0 })
      expect(integration).toMatchObject({ status: 'active', type: 'BANKING', credentialsEncrypted: true })
      expect([...integration.featureConfigs].sort((x, y) => x.feature.localeCompare(y.feature))).toEqual([
        { feature: 'BANKING_ACCOUNTS', enabled: true },
        { feature: 'BANKING_TRANSACTIONS', enabled: true },
      ])
      expect(JSON.stringify(integration.credentials)).not.toContain('ponto-secret-never-stored-clear')
      expect(response.text).not.toContain('ponto-secret')

      const line = await prisma.bankTransaction.findFirstOrThrow({ where: { externalTransactionId: 'p1' } })
      expect(line.amount.toFixed(2)).toBe('250.40')
      expect(line.side).toBe('credit')

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'BANK_PONTO_CONNECT' } })
      expect(audit).toMatchObject({ companyId: ids.aCompany, metadata: { integrationId: integration.id, accounts: 1 } })
    })

    it('replaces the credentials of the existing integration when connecting again', async () => {
      stubPonto()
      const { openCredentials } = await import('@/lib/banking/credentials')
      const key = 'b'.repeat(64)
      const first = await connectPonto(ids.aCompany, { clientId: 'old-id', clientSecret: 'old-secret' }, key)
      const second = await connectPonto(ids.aCompany, { clientId: 'new-id', clientSecret: 'new-secret' }, key)
      expect(second.integrationId).toBe(first.integrationId)
      expect(await prisma.integration.count({ where: { companyId: ids.aCompany, provider: 'PONTO' } })).toBe(1)
      const stored = await prisma.integration.findUniqueOrThrow({ where: { id: first.integrationId } })
      expect(openCredentials('PONTO', stored.credentials, stored.credentialsEncrypted, key, ids.aCompany)).toEqual({ clientId: 'new-id', clientSecret: 'new-secret' })
      // The line synced twice is stored once
      expect(await prisma.bankTransaction.count({ where: { externalTransactionId: 'p1' } })).toBe(1)
    })

    it('answers 400 in French for empty credentials, without calling Ponto', async () => {
      stubPonto()
      const response = await call('admin', connectPontoRoute, 'POST', '/api/banking/ponto', { companyId: ids.aCompany, clientId: '  ', clientSecret: 's' })
      expect(response.status).toBe(400)
      expect(String(response.json?.error)).toContain("Collez l'identifiant client (client ID) de l'intégration Ponto.")
      expect(outbound).toEqual([])
    })

    it('answers the French Ponto advice when Ponto refuses the credentials, and stores nothing', async () => {
      stubPonto({ refuse: true })
      const response = await call('admin', connectPontoRoute, 'POST', '/api/banking/ponto', body())
      expect(response.status).toBe(502)
      expect(response.json).toEqual({
        error: "Ponto refuse l'accès : vérifiez l'identifiant et le secret de l'intégration Ponto, ou renouvelez l'accès à votre banque.",
      })
      expect(response.text).not.toContain('ponto-client-xyz')
      expect(await prisma.integration.count({ where: { provider: 'PONTO' } })).toBe(0)
    })

    it('refuses a cross-site request (403) and a member of another company (404)', async () => {
      stubPonto()
      const crossSite = await call('admin', connectPontoRoute, 'POST', '/api/banking/ponto', body(), { 'sec-fetch-site': 'cross-site' })
      expect(crossSite.status).toBe(403)
      expect((await call('adminB', connectPontoRoute, 'POST', '/api/banking/ponto', body())).status).toBe(404)
      expect(outbound).toEqual([])
      expect(await prisma.integration.count({ where: { provider: 'PONTO' } })).toBe(0)
    })
  })

  describe('GET /api/ai-actions', () => {
    const NOW = Date.now()
    const action = (id: string, userId: string, over: { status?: string; createdAt?: Date; expiresAt?: Date } = {}) =>
      prisma.mcpPendingAction.create({
        data: {
          id,
          userId,
          caller: 'oauth:client-1',
          callerName: 'Claude',
          tool: 'create_draft_entry',
          companyId: ids.aCompany,
          args: { label: 'Loyer' },
          argsHash: 'h',
          preview: { lines: 2 },
          status: over.status ?? 'pending',
          createdAt: over.createdAt ?? new Date(NOW - 60_000),
          expiresAt: over.expiresAt ?? new Date(NOW + 3_600_000),
        },
      })

    it("lists the user's own recent actions, newest first, with expired ones marked", async () => {
      await action('act-old-pending', USERS.admin.id, { createdAt: new Date(NOW - 7_200_000), expiresAt: new Date(NOW - 3_600_000) })
      await action('act-new', USERS.admin.id, { createdAt: new Date(NOW - 60_000) })
      await action('act-approved', USERS.admin.id, { status: 'approved', createdAt: new Date(NOW - 600_000) })
      await action('act-other-user', USERS.viewer.id)
      // Past the 30 day retention
      await action('act-ancient', USERS.admin.id, { createdAt: new Date(NOW - 31 * 24 * 3_600_000) })

      const response = await call('admin', listAiActions, 'GET', '/api/ai-actions')
      expect(response.status).toBe(200)
      const actions = response.json?.actions as Array<Record<string, unknown>>
      expect(actions.map((a) => [a.id, a.status])).toEqual([
        ['act-new', 'pending'],
        ['act-approved', 'approved'],
        ['act-old-pending', 'expired'],
      ])
      expect(actions[0]).toMatchObject({
        tool: 'create_draft_entry',
        companyId: ids.aCompany,
        companyName: 'Atelier Alpha',
        callerName: 'Claude',
        args: { label: 'Loyer' },
        preview: { lines: 2 },
        decidedAt: null,
        executedAt: null,
      })
      expect(actions[0]).not.toHaveProperty('argsHash')
      expect(actions[0]).not.toHaveProperty('caller')
    })

    it('answers an empty list to a user without actions and 401 to an anonymous user', async () => {
      await action('act-new', USERS.admin.id)
      expect((await call('adminB', listAiActions, 'GET', '/api/ai-actions')).json).toEqual({ actions: [] })
      expect((await call('anonymous', listAiActions, 'GET', '/api/ai-actions')).status).toBe(401)
    })
  })
})
