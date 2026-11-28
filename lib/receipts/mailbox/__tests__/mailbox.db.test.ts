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
 *   reads every company's mailbox.
 * Skipped when the test database server is unreachable.
 */

import { Readable } from 'node:stream'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const imap = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('receipt_mailbox')
  process.env.RATE_LIMIT_DISABLED = 'true'
  process.env.ENCRYPTION_KEY = 'a'.repeat(64)
  interface Message {
    uid: number
    date: Date
    subject: string
    parts: Record<string, { type: string; fileName?: string; inline?: boolean; bytes: Buffer }>
  }
  return {
    password: 'app-password',
    uidValidity: BigInt(1),
    folders: { INBOX: [] as Message[], Factures: [] as Message[] } as Record<string, Message[]>,
    connections: [] as Array<{ host: string; user: string }>,
  }
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../imap-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../imap-client')>()),
  // An IMAP server in memory: the calls the service makes, nothing more
  openMailboxClient: (server: { host: string; username: string }, secret: { password?: string }) => {
    let selected = 'INBOX'
    const box = () => imap.folders[selected]
    return {
      mailbox: null as null | { uidValidity: bigint },
      async connect() {
        imap.connections.push({ host: server.host, user: server.username })
        if (secret.password !== imap.password) throw Object.assign(new Error('Invalid credentials'), { authenticationFailed: true })
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
})
