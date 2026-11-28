/**
 * The receipt mailbox against PostgreSQL (lib/receipts/mailbox/mailbox.service.ts),
 * with an IMAP server in memory in place of imapflow:
 * - saving signs in and checks the folder first; the password is stored
 *   encrypted, never shown, and never sent to another server;
 * - mode "read": nothing changes in the mailbox; the first reading takes
 *   the last 30 days, the next ones the new messages only; another
 *   UIDVALIDITY starts over without staging a file twice;
 * - mode "move": each message read goes to the chosen folder;
 * - a failed reading is recorded with its French reason; the nightly run
 *   reads every company's mailbox;
 * - signing in with a Google account: the callback checks the state, stores
 *   the tokens encrypted and reads INBOX; an expiring token is renewed and
 *   the new one stored; a revoked access asks to sign in again.
 * Skipped when the test database server is unreachable.
 */

import { Readable } from 'node:stream'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const imap = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('receipt_mailbox')
  process.env.RATE_LIMIT_DISABLED = 'true'
  process.env.ENCRYPTION_KEY = 'a'.repeat(64)
  process.env.GOOGLE_MAIL_CLIENT_ID = 'google-client'
  process.env.GOOGLE_MAIL_CLIENT_SECRET = 'google-secret'
  interface Message {
    uid: number
    date: Date
    subject: string
    parts: Record<string, { type: string; fileName?: string; inline?: boolean; bytes: Buffer }>
  }
  return {
    password: 'app-password',
    accessToken: 'access-1',
    uidValidity: BigInt(1),
    folders: { INBOX: [] as Message[], Factures: [] as Message[] } as Record<string, Message[]>,
    connections: [] as Array<{ host: string; user: string }>,
  }
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../imap-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../imap-client')>()),
  // An IMAP server in memory: the calls the service makes, nothing more
  openMailboxClient: (server: { host: string; username: string }, secret: { password?: string; accessToken?: string }) => {
    let selected = 'INBOX'
    const box = () => imap.folders[selected]
    return {
      mailbox: null as null | { uidValidity: bigint },
      async connect() {
        imap.connections.push({ host: server.host, user: server.username })
        const signedIn = secret.accessToken ? secret.accessToken === imap.accessToken : secret.password === imap.password
        if (!signedIn) throw Object.assign(new Error('Invalid credentials'), { authenticationFailed: true })
      },
      async list() {
        return Object.keys(imap.folders).map((path) => ({ path }))
      },
      async getMailboxLock(path: string) {
        selected = path
        this.mailbox = { uidValidity: imap.uidValidity }
        return { release() {} }
      },
      async search(query: { all?: boolean; since?: Date; uid?: string }) {
        if (query.since) return box().filter((m) => m.date >= (query.since as Date)).map((m) => m.uid)
        if (query.uid) return box().filter((m) => m.uid >= Number(query.uid?.split(':')[0])).map((m) => m.uid)
        return box().map((m) => m.uid)
      },
      async fetchOne(uid: string) {
        const message = box().find((m) => m.uid === Number(uid))
        if (!message) return false
        const childNodes = Object.entries(message.parts).map(([part, p]) => ({
          part,
          type: p.type,
          ...(p.inline ? { id: '<logo>', disposition: 'inline' } : { disposition: 'attachment' }),
          dispositionParameters: { filename: p.fileName },
        }))
        return { uid: message.uid, envelope: { subject: message.subject, messageId: `<${uid}@test>`, from: [{ address: 'factures@papeterie.fr' }] }, bodyStructure: { type: 'multipart/mixed', childNodes } }
      },
      async download(uid: string, part: string) {
        return { meta: {}, content: Readable.from([box().find((m) => m.uid === Number(uid))!.parts[part].bytes]) }
      },
      async mailboxCreate(path: string) {
        imap.folders[path] ??= []
      },
      async messageMove(uid: string, destination: string) {
        const index = box().findIndex((m) => m.uid === Number(uid))
        imap.folders[destination].push(...box().splice(index, 1))
      },
      async logout() {},
      close() {},
    }
  },
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { ciiXml, facturXPdf, sampleInvoice } from '@/lib/invoices/e-invoice/__tests__/fixtures'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
let prisma: Prisma
let service: typeof import('../mailbox.service')

const NOW = new Date('2026-11-28T08:00:00Z')
const ids = {} as Record<string, string>
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
const invoice = (number: string) => Buffer.from(facturXPdf(ciiXml(sampleInvoice({ number }))))
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const SETTINGS = { host: 'imap.example.fr', username: 'factures@atelier.fr', password: 'app-password', folder: 'Factures', mode: 'read' as const }

function mail(uid: number, date: Date, parts: Record<string, { type: string; fileName?: string; inline?: boolean; bytes: Buffer }>) {
  return { uid, date, subject: `Message ${uid}`, parts }
}

describe.skipIf(!available)('receipt mailbox', () => {
  beforeAll(async () => {
    await prepareTestDatabase('receipt_mailbox')
    ;({ prisma } = await import('@/lib/prisma'))
    service = await import('../mailbox.service')
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('receipt_mailbox')
    imap.password = 'app-password'
    imap.accessToken = 'access-1'
    imap.uidValidity = BigInt(1)
    imap.connections.length = 0
    imap.folders = {
      INBOX: [],
      Factures: [
        mail(1, daysAgo(40), { '2': { type: 'application/pdf', fileName: 'ancienne.pdf', bytes: invoice('OLD-1') } }),
        mail(2, daysAgo(3), { '2': { type: 'application/pdf', fileName: 'F2026-0042.pdf', bytes: invoice('F2026-0042') } }),
        mail(3, daysAgo(2), { '2': { type: 'image/png', fileName: 'logo.png', inline: true, bytes: PNG } }),
      ],
    }
    await prisma.user.create({ data: { id: 'u-admin', email: 'admin@test.local', name: 'Admin' } })
    const company = await prisma.company.create({ data: { name: 'Atelier Martin', slug: 'atelier-martin', siren: '930000120' } })
    Object.assign(ids, { company: company.id })
  })

  const staged = () => prisma.stagedReceipt.findMany({ where: { companyId: ids.company }, select: { fileName: true, source: true, status: true }, orderBy: { fileName: 'asc' } })

  it('signs in and checks the folder before saving, and keeps the password encrypted', async () => {
    imap.password = 'the-real-one'
    await expect(service.saveMailbox(ids.company, 'u-admin', SETTINGS)).rejects.toThrow(/mot de passe d’application/)
    imap.password = 'app-password'
    await expect(service.saveMailbox(ids.company, 'u-admin', { ...SETTINGS, folder: 'Archives' })).rejects.toThrow(/« Archives » n’existe pas/)

    const view = await service.saveMailbox(ids.company, 'u-admin', SETTINGS)
    expect(view).toMatchObject({ configured: true, host: 'imap.example.fr', username: 'factures@atelier.fr', folder: 'Factures', mode: 'read', lastError: null })
    expect(JSON.stringify(view)).not.toContain('app-password')
    const row = await prisma.integration.findFirstOrThrow({ where: { companyId: ids.company, provider: 'IMAP' } })
    expect(row).toMatchObject({ type: 'RECEIPTS', credentialsEncrypted: true })
    expect(JSON.stringify(row.credentials)).not.toContain('app-password')

    // The stored password goes to the same server and user name only
    await expect(service.saveMailbox(ids.company, 'u-admin', { ...SETTINGS, host: 'imap.ailleurs.fr', password: '' })).rejects.toThrow(/Indiquez le mot de passe/)
    expect(imap.connections.some((c) => c.host === 'imap.ailleurs.fr')).toBe(false)
  })

  it('reads the last 30 days first, then the new messages only, without changing the mailbox', async () => {
    await service.saveMailbox(ids.company, 'u-admin', SETTINGS)
    expect(await service.readMailbox(ids.company, NOW)).toEqual({ messages: 2, staged: 1, more: false })
    expect(await staged()).toEqual([{ fileName: 'F2026-0042.pdf', source: 'email', status: 'staged' }])
    expect(imap.folders.Factures.map((m) => m.uid)).toEqual([1, 2, 3])

    expect(await service.readMailbox(ids.company, NOW)).toEqual({ messages: 0, staged: 0, more: false })
    imap.folders.Factures.push(mail(4, daysAgo(0), { '2': { type: 'application/pdf', fileName: 'F2026-0043.pdf', bytes: invoice('F2026-0043') } }))
    expect(await service.readMailbox(ids.company, NOW)).toEqual({ messages: 1, staged: 1, more: false })

    // The server renumbered the folder: read again, nothing staged twice
    imap.uidValidity = BigInt(2)
    expect(await service.readMailbox(ids.company, NOW)).toMatchObject({ messages: 3, staged: 0 })
    expect(await staged()).toHaveLength(2)
    expect((await service.mailboxOf(ids.company)).lastReadAt).toBe(NOW.toISOString())
  })

  it('moves each message read to the chosen folder', async () => {
    await service.saveMailbox(ids.company, 'u-admin', { ...SETTINGS, mode: 'move', moveTo: 'Kledg/Traités' })
    expect(await service.readMailbox(ids.company, NOW)).toMatchObject({ messages: 3, staged: 2 })
    expect(imap.folders.Factures).toEqual([])
    expect(imap.folders['Kledg/Traités'].map((m) => m.uid)).toEqual([1, 2, 3])
  })

  it('records a failed reading with its reason, and the nightly run reads every mailbox', async () => {
    await service.saveMailbox(ids.company, 'u-admin', SETTINGS)
    imap.password = 'changed-by-the-user'
    await expect(service.readMailbox(ids.company, NOW)).rejects.toThrow(/refuse l’identifiant ou le mot de passe/)
    expect(await service.mailboxOf(ids.company)).toMatchObject({ lastError: expect.stringContaining('refuse') })
    expect((await prisma.integration.findFirstOrThrow({ where: { provider: 'IMAP' } })).status).toBe('error')

    imap.password = 'app-password'
    expect(await service.readAllMailboxes(NOW)).toEqual([{ companyId: ids.company, ok: true, staged: 1 }])
    expect(await service.mailboxOf(ids.company)).toMatchObject({ lastError: null })

    await service.deleteMailbox(ids.company, 'u-admin')
    expect(await service.mailboxOf(ids.company)).toMatchObject({ configured: false })
  })

  describe('signed in with a Google account', () => {
    const idToken = (email: string) => `e30.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.sig`
    const tokenEndpoint = (responses: Array<{ status: number; body: Record<string, unknown> }>) => {
      const forms: URLSearchParams[] = []
      const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
        forms.push(new URLSearchParams(String(init.body)))
        const next = responses.shift() ?? { status: 500, body: {} }
        return new Response(JSON.stringify(next.body), { status: next.status })
      })
      return { forms, fetcher: fetcher as unknown as typeof fetch }
    }

    async function signIn(fetcher: typeof fetch, now = NOW) {
      const { state } = service.startMailboxOAuth(ids.company, 'u-admin', 'google', now)
      return { state, outcome: await service.finishMailboxOAuth({ companyId: ids.company, userId: 'u-admin', query: { code: 'code-1', state }, cookieState: state, fetch: fetcher, now }) }
    }

    it('checks the state, stores the tokens encrypted and reads INBOX without changing it', async () => {
      const { state } = service.startMailboxOAuth(ids.company, 'u-admin', 'google', NOW)
      // Another user, another browser (no cookie), another state: refused before any exchange
      const finish = (userId: string, cookieState: string | null, queryState = state) =>
        service.finishMailboxOAuth({ companyId: ids.company, userId, query: { code: 'code-1', state: queryState }, cookieState, fetch: vi.fn() as unknown as typeof fetch, now: NOW })
      await expect(finish('u-other', state)).rejects.toThrow(/invalide ou expiré/)
      await expect(finish('u-admin', null)).rejects.toThrow(/invalide ou expiré/)
      await expect(finish('u-admin', state, `${state}x`)).rejects.toThrow(/invalide ou expiré/)
      expect(await service.finishMailboxOAuth({ companyId: ids.company, userId: 'u-admin', query: { state, error: 'access_denied' }, cookieState: state, now: NOW })).toBe('denied')

      const google = tokenEndpoint([{ status: 200, body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, id_token: idToken('Factures@Atelier.fr') } }])
      // Signed in now: saving the settings below checks the token against the clock
      expect((await signIn(google.fetcher, new Date())).outcome).toBe('connected')
      expect(google.forms[0].get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(imap.connections.at(-1)).toEqual({ host: 'imap.gmail.com', user: 'factures@atelier.fr' })
      expect(await service.mailboxOf(ids.company)).toMatchObject({ configured: true, auth: 'google', oauthProviders: ['google'], host: 'imap.gmail.com', username: 'factures@atelier.fr', folder: 'INBOX', mode: 'read' })
      const row = await prisma.integration.findFirstOrThrow({ where: { companyId: ids.company, provider: 'IMAP' } })
      expect(JSON.stringify(row.credentials)).not.toMatch(/access-1|refresh-1/)

      // The folder is then chosen like any mailbox, without a password: the account signs in
      imap.folders.INBOX = imap.folders.Factures
      expect(await service.saveMailbox(ids.company, 'u-admin', { ...SETTINGS, host: 'imap.gmail.com', username: 'factures@atelier.fr', password: '', folder: 'Factures' })).toMatchObject({ auth: 'google', folder: 'Factures' })
      expect(await service.readMailbox(ids.company, NOW)).toMatchObject({ messages: 2, staged: 1 })
    })

    it('renews an expiring token and stores the new one; a revoked access asks to sign in again', async () => {
      await signIn(tokenEndpoint([{ status: 200, body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, id_token: idToken('factures@atelier.fr') } }]).fetcher)
      const later = new Date(NOW.getTime() + 3600_000)
      imap.accessToken = 'access-2'
      const renewal = tokenEndpoint([{ status: 200, body: { access_token: 'access-2', expires_in: 3600 } }])
      vi.stubGlobal('fetch', renewal.fetcher)
      try {
        await service.readMailbox(ids.company, later)
        expect(Object.fromEntries(renewal.forms[0])).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-1' })
        // Still valid an hour later minus the margin: no new renewal
        await service.readMailbox(ids.company, new Date(later.getTime() + 30 * 60_000))
        expect(renewal.forms).toHaveLength(1)

        vi.stubGlobal('fetch', tokenEndpoint([{ status: 400, body: { error: 'invalid_grant' } }]).fetcher)
        await expect(service.readMailbox(ids.company, new Date(later.getTime() + 2 * 3600_000))).rejects.toThrow(/retiré ou a expiré/)
        expect(await service.mailboxOf(ids.company)).toMatchObject({ lastError: expect.stringContaining('reconnectez') })
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })
})
