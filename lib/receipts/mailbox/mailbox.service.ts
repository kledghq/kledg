/**
 * Receipt mailbox of a company (docs/justificatifs-email.md#boîte-e-mail):
 * an IMAP mailbox Kledg reads for the receipts sent to it, every night with
 * the bank sync and on demand. Its attachments are received like those of
 * the receipt address (lib/receipts/inbound/receive-email.service.ts): read,
 * matched as suggestions, attached only on a member's click.
 *
 * Stored as an integration (provider IMAP, type RECEIPTS): the host and the
 * user name in clear, the password (or the OAuth tokens) encrypted with the
 * instance key (lib/banking/credentials.ts), the settings in config:
 * - folder: the one folder read (a dedicated mailbox or folder is advised:
 *   Kledg reads the attachments of every message in it);
 * - mode "read" (default): nothing is changed in the mailbox; Kledg
 *   remembers the last message read (UID and UIDVALIDITY, RFC 3501 2.3.1.1).
 *   The first reading takes the messages of the last FIRST_READING_DAYS days;
 * - mode "move": each message read is moved to moveTo (created if missing),
 *   so the folder only holds what is still to read.
 * A run reads MAX_MESSAGES messages at most; the next run continues.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { ValidationError, NotFoundError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { openCredentials, requireEncryptionKey, sealCredentials } from '@/lib/banking/credentials'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { withSystemContext } from '@/lib/rls/context'
import { RECEIPT_MAX_BYTES } from '../file-type'
import type { InboundEmail } from '../inbound/adapters'
import { receiveEmailForCompany } from '../inbound/receive-email.service'
import { normalizeHost, openMailboxClient, type MailboxSecret, type MailboxServer } from './imap-client'
import { attachmentParts, type StructurePart } from './parts'

const PROVIDER = 'IMAP' as const
export const MAX_MESSAGES = 100
export const FIRST_READING_DAYS = 30
const DEFAULT_MOVE_TO = 'Kledg/Traités'

export type MailboxMode = 'read' | 'move'

const ConfigSchema = z.object({
  folder: z.string().default('INBOX'),
  mode: z.enum(['read', 'move']).default('read'),
  moveTo: z.string().nullish(),
  uidValidity: z.string().nullish(),
  lastUid: z.number().int().nullish(),
  lastError: z.string().nullish(),
})
type MailboxConfig = z.infer<typeof ConfigSchema>

export const MailboxInputSchema = z.object({
  host: z.string().trim().max(253).transform((value, ctx) => {
    const host = normalizeHost(value)
    if (!host) ctx.addIssue({ code: 'custom', message: 'Serveur IMAP invalide : un nom comme imap.example.fr.' })
    return host ?? ''
  }),
  username: z.string().trim().min(1, 'Indiquez l’identifiant de la boîte (souvent l’adresse e-mail).').max(320),
  /** Required to create the mailbox; left empty to keep the stored one. */
  password: z.string().max(500).optional(),
  folder: z.string().trim().min(1).max(200).default('INBOX'),
  mode: z.enum(['read', 'move'], { message: 'Choisissez : lire seulement, ou déplacer les messages lus.' }).default('read'),
  moveTo: z.string().trim().min(1).max(200).optional(),
})
export type MailboxInput = z.input<typeof MailboxInputSchema>

export interface MailboxView {
  configured: boolean
  host: string | null
  username: string | null
  folder: string | null
  mode: MailboxMode | null
  moveTo: string | null
  lastReadAt: string | null
  /** Why the last reading failed, in French; null when it worked. */
  lastError: string | null
}

const NONE: MailboxView = { configured: false, host: null, username: null, folder: null, mode: null, moveTo: null, lastReadAt: null, lastError: null }

const integrationOf = (companyId: string) =>
  prisma.integration.findFirst({ where: { companyId, provider: PROVIDER, type: 'RECEIPTS' }, orderBy: { createdAt: 'asc' } })

type MailboxIntegration = NonNullable<Awaited<ReturnType<typeof integrationOf>>>

function configOf(row: { config: Prisma.JsonValue }): MailboxConfig {
  const parsed = ConfigSchema.safeParse(row.config ?? {})
  return parsed.success ? parsed.data : ConfigSchema.parse({})
}

function serverOf(row: MailboxIntegration): { server: MailboxServer; secret: MailboxSecret } {
  const credentials = openCredentials(PROVIDER, row.credentials, row.credentialsEncrypted, requireEncryptionKey(), row.companyId)
  const host = String(credentials.host ?? '')
  const username = String(credentials.username ?? '')
  const secret: MailboxSecret = typeof credentials.accessToken === 'string' && credentials.accessToken ? { accessToken: credentials.accessToken } : { password: String(credentials.password ?? '') }
  return { server: { host, username }, secret }
}

export async function mailboxOf(companyId: string): Promise<MailboxView> {
  const row = await integrationOf(companyId)
  if (!row) return NONE
  const config = configOf(row)
  const credentials = (row.credentials ?? {}) as Record<string, unknown>
  return {
    configured: true,
    host: typeof credentials.host === 'string' ? credentials.host : null,
    username: typeof credentials.username === 'string' ? credentials.username : null,
    folder: config.folder,
    mode: config.mode,
    moveTo: config.mode === 'move' ? (config.moveTo ?? DEFAULT_MOVE_TO) : null,
    lastReadAt: row.lastSyncAt?.toISOString() ?? null,
    lastError: config.lastError ?? null,
  }
}

/** What the server answered, in French: the message the user acts on. */
export function mailboxErrorMessage(error: unknown): string {
  const e = error as { authenticationFailed?: boolean; code?: string; message?: string; name?: string }
  if (e?.name === 'BlockedAddressError') return 'Ce serveur n’a pas d’adresse publique : Kledg ne se connecte qu’à des serveurs IMAP sur internet.'
  if (e?.authenticationFailed || e?.code === 'AUTHENTICATIONFAILED') return 'Le serveur refuse l’identifiant ou le mot de passe. Pour Gmail ou iCloud, utilisez un mot de passe d’application.'
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') return 'Serveur IMAP introuvable : vérifiez son nom (par exemple imap.example.fr).'
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ConnectionTimeout' || e?.code === 'GreetingTimeout') {
    return 'Le serveur IMAP ne répond pas sur le port 993 (IMAPS) : Kledg n’accepte que les connexions chiffrées dès le départ.'
  }
  if (e?.code === 'CERT_HAS_EXPIRED' || /certificate|self.signed/i.test(e?.message ?? '')) return 'Le certificat du serveur IMAP n’est pas valable pour ce nom : Kledg refuse la connexion.'
  return 'La connexion à la boîte e-mail a échoué. Vérifiez le serveur et l’identifiant, puis réessayez.'
}

/** Connects and lists the folders: the check run before a mailbox is saved. */
export async function testMailbox(server: MailboxServer, secret: MailboxSecret): Promise<{ folders: string[] }> {
  const client = openMailboxClient(server, secret)
  try {
    await client.connect()
    const list = await client.list()
    return { folders: list.map((box) => box.path).sort((a, b) => (a === 'INBOX' ? -1 : b === 'INBOX' ? 1 : a.localeCompare(b))) }
  } catch (error) {
    throw new ValidationError(mailboxErrorMessage(error))
  } finally {
    await client.logout().catch(() => client.close())
  }
}

/** The folders of a mailbox being set up; an empty password uses the stored one (same server and user name only). */
export async function mailboxFolders(companyId: string, input: { host: string; username: string; password?: string }): Promise<{ folders: string[] }> {
  const existing = await integrationOf(companyId)
  const stored = existing ? serverOf(existing) : null
  const same = stored?.server.host === input.host && stored?.server.username === input.username
  const password = input.password?.trim() ? input.password : same && stored && 'password' in stored.secret ? stored.secret.password : ''
  if (!password) throw new ValidationError('Indiquez le mot de passe de la boîte (ou un mot de passe d’application).')
  return testMailbox({ host: input.host, username: input.username }, { password })
}

/** Creates or updates the company's mailbox, once the connection and the folder are checked. */
export async function saveMailbox(companyId: string, userId: string, input: z.output<typeof MailboxInputSchema>): Promise<MailboxView> {
  const existing = await integrationOf(companyId)
  const stored = existing ? serverOf(existing) : null
  // The stored password is only kept for the same server and user name: never sent to another host
  const same = stored?.server.host === input.host && stored?.server.username === input.username
  const password = input.password?.trim() ? input.password : same && stored && 'password' in stored.secret ? stored.secret.password : ''
  if (!password) throw new ValidationError('Indiquez le mot de passe de la boîte (ou un mot de passe d’application).')
  const server = { host: input.host, username: input.username }
  const { folders } = await testMailbox(server, { password })
  if (!folders.includes(input.folder)) throw new ValidationError(`Le dossier « ${input.folder} » n’existe pas dans cette boîte.`)

  const sameFolder = existing && configOf(existing).folder === input.folder && stored?.server.host === input.host && stored?.server.username === input.username
  const before = existing ? configOf(existing) : null
  const config: MailboxConfig = {
    folder: input.folder,
    mode: input.mode,
    moveTo: input.mode === 'move' ? (input.moveTo ?? DEFAULT_MOVE_TO) : null,
    // Another folder or another mailbox: read from the start again
    uidValidity: sameFolder ? (before?.uidValidity ?? null) : null,
    lastUid: sameFolder ? (before?.lastUid ?? null) : null,
    lastError: null,
  }
  const key = requireEncryptionKey()
  const credentials = sealCredentials(PROVIDER, { host: server.host, username: server.username, password }, key, companyId) as Prisma.InputJsonValue
  if (existing) {
    await prisma.integration.update({ where: { id: existing.id }, data: { credentials, credentialsEncrypted: true, config: config as Prisma.InputJsonValue, status: 'active' } })
  } else {
    await prisma.integration.create({
      data: { companyId, provider: PROVIDER, type: 'RECEIPTS', name: 'Boîte e-mail des justificatifs', status: 'active', credentials, credentialsEncrypted: true, config: config as Prisma.InputJsonValue },
    })
  }
  await writeAuditLog('info', existing ? 'Receipt mailbox updated' : 'Receipt mailbox connected', {
    action: 'RECEIPT_MAILBOX_SAVED',
    companyId,
    metadata: { host: server.host, folder: input.folder, mode: input.mode },
    context: { userId },
  })
  return mailboxOf(companyId)
}

export async function deleteMailbox(companyId: string, userId: string): Promise<void> {
  const existing = await integrationOf(companyId)
  if (!existing) throw new NotFoundError('Aucune boîte e-mail n’est connectée.')
  await prisma.integration.delete({ where: { id: existing.id } })
  await writeAuditLog('info', 'Receipt mailbox removed', { action: 'RECEIPT_MAILBOX_REMOVED', companyId, metadata: {}, context: { userId } })
}

async function downloadPart(client: ReturnType<typeof openMailboxClient>, uid: number, part: string): Promise<Uint8Array> {
  const download = await client.download(String(uid), part, { uid: true, maxBytes: RECEIPT_MAX_BYTES + 1 })
  if (!download.content) throw new Error('part not found')
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of download.content as AsyncIterable<Buffer>) {
    total += chunk.length
    if (total > RECEIPT_MAX_BYTES) {
      download.content.destroy()
      throw new Error('attachment too large')
    }
    chunks.push(chunk)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

export interface MailboxReading {
  messages: number
  staged: number
  /** More messages wait for the next run. */
  more: boolean
}

/** Reads the new messages of the company's mailbox. Runs in the caller's context (a member's, or the cron's for that company). */
export async function readMailbox(companyId: string, now: Date = new Date()): Promise<MailboxReading> {
  const row = await integrationOf(companyId)
  if (!row) throw new NotFoundError('Aucune boîte e-mail n’est connectée.')
  const config = configOf(row)
  const { server, secret } = serverOf(row)
  const client = openMailboxClient(server, secret)
  const result: MailboxReading = { messages: 0, staged: 0, more: false }
  let lastUid = config.lastUid ?? null
  let uidValidity = config.uidValidity ?? null
  let failure: string | null = null
  try {
    await client.connect()
    const lock = await client.getMailboxLock(config.folder)
    try {
      const mailbox = client.mailbox
      const validity = mailbox ? String(mailbox.uidValidity) : null
      // UIDs mean something only within one UIDVALIDITY: another one starts over (staging ignores files already seen)
      if (validity !== uidValidity) lastUid = null
      uidValidity = validity
      const since = new Date(now.getTime() - FIRST_READING_DAYS * 86_400_000)
      const uids =
        config.mode === 'move'
          ? ((await client.search({ all: true }, { uid: true })) || [])
          : lastUid === null
            ? ((await client.search({ since }, { uid: true })) || [])
            : ((await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || []).filter((uid) => uid > (lastUid as number))
      const batch = [...uids].sort((a, b) => a - b).slice(0, MAX_MESSAGES)
      result.more = uids.length > batch.length
      if (config.mode === 'move' && batch.length > 0) await client.mailboxCreate(config.moveTo ?? DEFAULT_MOVE_TO).catch(() => undefined)

      for (const uid of batch) {
        const message = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true })
        if (!message) continue
        const parts = attachmentParts(message.bodyStructure as StructurePart | undefined)
        const email: InboundEmail = {
          messageId: message.envelope?.messageId ?? null,
          from: message.envelope?.from?.[0]?.address?.toLowerCase() ?? null,
          recipients: [],
          subject: message.envelope?.subject?.slice(0, 500) ?? null,
          attachments: parts.map((part) => ({ ...part, load: () => downloadPart(client, uid, part.part) })),
        }
        const received = await receiveEmailForCompany(companyId, email, 'imap')
        result.messages++
        result.staged += received.staged
        if (config.mode === 'move') await client.messageMove(String(uid), config.moveTo ?? DEFAULT_MOVE_TO, { uid: true })
        else lastUid = uid
        // The day's limit of emailed receipts: the rest waits for the next run
        if (received.limited) {
          result.more = true
          break
        }
      }
    } finally {
      lock.release()
    }
  } catch (error) {
    failure = mailboxErrorMessage(error)
    logger.warn('[Receipts] Mailbox reading failed', { companyId, reason: (error as Error).message })
  } finally {
    await client.logout().catch(() => client.close())
    const next: MailboxConfig = { ...config, lastUid, uidValidity, lastError: failure }
    await prisma.integration.update({
      where: { id: row.id },
      data: { config: next as Prisma.InputJsonValue, status: failure ? 'error' : 'active', ...(failure ? {} : { lastSyncAt: now }) },
    })
  }
  if (failure) throw new ValidationError(failure)
  return result
}

/** The nightly run: every company's mailbox, each in its own context. Never throws. */
export async function readAllMailboxes(now: Date = new Date(), options: { notReadSince?: Date } = {}): Promise<Array<{ companyId: string; ok: boolean; staged: number }>> {
  const stale = options.notReadSince ? { OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: options.notReadSince } }] } : {}
  const rows = await withSystemContext('cron:bank-sync', () =>
    prisma.integration.findMany({ where: { provider: PROVIDER, type: 'RECEIPTS', status: { in: ['active', 'error'] }, ...stale }, select: { companyId: true } }),
  )
  const results: Array<{ companyId: string; ok: boolean; staged: number }> = []
  for (const { companyId } of rows) {
    try {
      const reading = await withSystemContext('cron:bank-sync', () => readMailbox(companyId, now), { companyIds: [companyId] })
      results.push({ companyId, ok: true, staged: reading.staged })
    } catch {
      results.push({ companyId, ok: false, staged: 0 })
    }
  }
  return results
}

