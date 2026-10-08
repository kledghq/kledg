/**
 * Staged receipts (docs/justificatifs-photo.md): a photo or a PDF of a
 * receipt sent to Kledg before it is filed, from an assistant (the capture
 * view, a ChatGPT file, base64) or the Justificatifs page. Every source ends
 * here, with the same checks:
 * - the type is read from the bytes (JPEG, PNG or PDF; lib/receipts/file-type.ts),
 *   never from the name or a declared type, and the size is capped
 *   (RECEIPT_MAX_BYTES);
 * - the same content is staged once per company (SHA-256): sending it again
 *   returns the receipt already staged, attached or turned into an expense
 *   line, so a retried call files nothing twice;
 * - the bytes go to receipt_files (company table, row level security), the
 *   receipt to staged_receipts with its uploader;
 * - a member sees the receipts they staged; a member who reconciles the
 *   bank or validates expense reports sees every receipt of the company
 *   (StagedReceiptActor). Another member's receipt is "introuvable";
 * - an unclaimed receipt (staged or discarded) expires STAGED_RECEIPT_TTL_DAYS
 *   after it was staged: it is deleted with its file, when a receipt of the
 *   company is next staged (purgeExpiredReceipts), no cron needed;
 * - staging counts in the user's limit of receipt uploads (receipt-upload,
 *   lib/rate-limit.ts).
 */

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { enforceRateLimit } from '@/lib/rate-limit'
import { calendarDayOf } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import { RECEIPT_FILE_MESSAGES, RECEIPT_MAX_BYTES, checkReceiptFile, receiptFileName, type ReceiptContentType } from './file-type'

export const STAGED_RECEIPT_TTL_DAYS = 30
const DAY_MS = 86_400_000

export const RECEIPT_SOURCES = ['view', 'file_param', 'base64', 'app'] as const
export type ReceiptSource = (typeof RECEIPT_SOURCES)[number]

export type StagedReceiptStatus = 'staged' | 'attached' | 'expense' | 'discarded'

export const STAGED_RECEIPT_NOT_FOUND = 'Justificatif introuvable : déposez-le de nouveau.'

/** Who acts on staged receipts: their uploader, or a member who files everyone's. */
export interface StagedReceiptActor {
  userId: string
  /** banking:reconcile or expenses:validate in the company: every staged receipt of the company. */
  seesAll: boolean
}

/** A VAT amount read on the receipt, in cents, with its rate in basis points (2000 = 20 %). */
export interface ReceiptVatLine {
  rateBp: number
  amountCents: number
}

export interface StagedReceiptView {
  id: string
  status: StagedReceiptStatus
  fileName: string
  contentType: string
  size: number
  sha256: string
  source: ReceiptSource
  stagedAt: string
  expiresAt: string
  /** Fields read on the receipt (by the assistant or typed by the user); null until given. */
  fields: {
    amountCents: number | null
    currency: string | null
    date: string | null
    merchant: string | null
    vatLines: ReceiptVatLine[]
    paymentHint: string | null
  }
  bankTransactionId: string | null
  expenseReportId: string | null
  /** The file is still kept by Kledg (false once sent to Qonto or discarded). */
  hasFile: boolean
}

export const STAGED_SELECT = {
  id: true,
  companyId: true,
  status: true,
  fileId: true,
  fileName: true,
  contentType: true,
  size: true,
  sha256: true,
  source: true,
  uploadedById: true,
  amount: true,
  currency: true,
  receiptDate: true,
  merchantName: true,
  vatLines: true,
  paymentHint: true,
  bankTransactionId: true,
  attachmentId: true,
  expenseReportId: true,
  expenseLineId: true,
  createdAt: true,
  expiresAt: true,
} satisfies Prisma.StagedReceiptSelect

export type StagedReceiptRow = Prisma.StagedReceiptGetPayload<{ select: typeof STAGED_SELECT }>

function vatLinesOf(value: Prisma.JsonValue | null): ReceiptVatLine[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const { rateBp, amountCents } = item as Record<string, unknown>
    return typeof rateBp === 'number' && typeof amountCents === 'number' ? [{ rateBp, amountCents }] : []
  })
}

export function stagedReceiptView(row: StagedReceiptRow): StagedReceiptView {
  return {
    id: row.id,
    status: row.status as StagedReceiptStatus,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
    sha256: row.sha256,
    source: row.source as ReceiptSource,
    stagedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    fields: {
      amountCents: row.amount === null ? null : parseCents(row.amount),
      currency: row.currency,
      date: calendarDayOf(row.receiptDate),
      merchant: row.merchantName,
      vatLines: vatLinesOf(row.vatLines),
      paymentHint: row.paymentHint,
    },
    bankTransactionId: row.bankTransactionId,
    expenseReportId: row.expenseReportId,
    hasFile: row.fileId !== null,
  }
}

/** The scope of the receipts an actor reaches in a company. */
export function visibleReceipts(companyId: string, actor: StagedReceiptActor): Prisma.StagedReceiptWhereInput {
  return actor.seesAll ? { companyId } : { companyId, uploadedById: actor.userId }
}

/** A staged receipt the actor reaches, or "introuvable". */
export async function findStagedReceipt(companyId: string, id: string, actor: StagedReceiptActor, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<StagedReceiptRow> {
  const row = await db.stagedReceipt.findFirst({ where: { id, ...visibleReceipts(companyId, actor) }, select: STAGED_SELECT })
  if (!row) throw new NotFoundError(STAGED_RECEIPT_NOT_FOUND)
  return row
}

/** Company of a staged receipt (resolver of the routes). */
export function companyOfStagedReceipt(id: string): Promise<{ companyId: string } | null> {
  return prisma.stagedReceipt.findUnique({ where: { id }, select: { companyId: true } })
}

/**
 * Deletes the company's unclaimed receipts past their expiry, then the
 * stored files nothing refers to any more (no staged receipt, no
 * attachment): the file of an attached or expensed receipt stays.
 */
export async function purgeExpiredReceipts(companyId: string, now: Date = new Date()): Promise<{ receipts: number; files: number }> {
  const receipts = await prisma.stagedReceipt.deleteMany({ where: { companyId, status: { in: ['staged', 'discarded'] }, expiresAt: { lt: now } } })
  const files = await prisma.receiptFile.deleteMany({ where: { companyId, stagedReceipts: { none: {} }, attachments: { none: {} } } })
  return { receipts: receipts.count, files: files.count }
}

export interface StageReceiptInput {
  bytes: Uint8Array
  fileName?: string | null
  source: ReceiptSource
}

/**
 * Stages a receipt of the company. Returns the staged receipt, and
 * `duplicate: true` when the same content was already staged (whatever its
 * status: a receipt already attached says so, nothing is filed twice).
 */
export async function stageReceipt(
  companyId: string,
  actor: StagedReceiptActor,
  input: StageReceiptInput,
  now: Date = new Date(),
): Promise<{ receipt: StagedReceiptView; duplicate: boolean }> {
  await enforceRateLimit('receipt-upload', actor.userId)
  const check = checkReceiptFile(input.bytes)
  if (!check.ok) throw new ValidationError(check.message)
  const contentType: ReceiptContentType = check.contentType
  const sha256 = createHash('sha256').update(input.bytes).digest('hex')
  const fileName = receiptFileName(input.fileName, contentType)
  const expiresAt = new Date(now.getTime() + STAGED_RECEIPT_TTL_DAYS * DAY_MS)
  await purgeExpiredReceipts(companyId, now)

  const outcome = await prisma.$transaction(async (tx) => {
    // One staging of a content at a time in a company: a retried call waits, then finds the first one.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:staged-receipt:${companyId}:${sha256}`}))`
    const existing = await tx.stagedReceipt.findUnique({ where: { companyId_sha256: { companyId, sha256 } }, select: STAGED_SELECT })
    if (existing && existing.status !== 'discarded') {
      if (!actor.seesAll && existing.uploadedById !== actor.userId) {
        throw new ConflictError('Ce justificatif a déjà été déposé par un autre membre de la société.')
      }
      return { row: existing, duplicate: true }
    }
    const file = await tx.receiptFile.upsert({
      where: { companyId_sha256: { companyId, sha256 } },
      create: { companyId, sha256, contentType, size: input.bytes.length, content: Buffer.from(input.bytes) },
      update: {},
      select: { id: true },
    })
    const data = { fileId: file.id, fileName, contentType, size: input.bytes.length, source: input.source, status: 'staged', uploadedById: actor.userId, expiresAt }
    const row = existing
      ? // A discarded receipt sent again starts over, without the fields read before.
        await tx.stagedReceipt.update({
          where: { id: existing.id },
          data: { ...data, amount: null, currency: null, receiptDate: null, merchantName: null, vatLines: Prisma.DbNull, paymentHint: null, bankTransactionId: null, attachmentId: null, expenseReportId: null, expenseLineId: null },
          select: STAGED_SELECT,
        })
      : await tx.stagedReceipt.create({ data: { companyId, sha256, ...data }, select: STAGED_SELECT })
    return { row, duplicate: false }
  })

  if (!outcome.duplicate) {
    await writeAuditLog('info', 'Receipt staged', {
      action: 'RECEIPT_STAGED',
      companyId,
      metadata: { stagedReceiptId: outcome.row.id, source: input.source, contentType, size: input.bytes.length },
    })
  }
  return { receipt: stagedReceiptView(outcome.row), duplicate: outcome.duplicate }
}

/** The receipts the actor staged and has not filed yet, newest first (the drop zone after a reload). */
export async function listPendingReceipts(companyId: string, actor: StagedReceiptActor, now: Date = new Date()): Promise<StagedReceiptView[]> {
  const rows = await prisma.stagedReceipt.findMany({
    where: { companyId, uploadedById: actor.userId, status: 'staged', expiresAt: { gte: now } },
    select: STAGED_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return rows.map(stagedReceiptView)
}

/** Discards a receipt that was not filed: its file is deleted, the receipt row expires with the others. */
export async function discardStagedReceipt(companyId: string, id: string, actor: StagedReceiptActor): Promise<StagedReceiptView> {
  const row = await findStagedReceipt(companyId, id, actor)
  if (row.status === 'discarded') return stagedReceiptView(row)
  if (row.status !== 'staged') throw new ConflictError('Ce justificatif est déjà classé : il ne peut plus être abandonné.')
  const updated = await prisma.stagedReceipt.updateMany({ where: { id, companyId, status: 'staged' }, data: { status: 'discarded', fileId: null } })
  if (updated.count === 0) throw new ConflictError('Ce justificatif vient d’être classé : il ne peut plus être abandonné.')
  await prisma.receiptFile.deleteMany({ where: { companyId, stagedReceipts: { none: {} }, attachments: { none: {} } } })
  await writeAuditLog('info', 'Staged receipt discarded', { action: 'RECEIPT_DISCARDED', companyId, metadata: { stagedReceiptId: id } })
  return stagedReceiptView(await findStagedReceipt(companyId, id, actor))
}

/** A receipt uploaded from the Justificatifs page (multipart field "file"): the size is checked before the bytes are read. */
export async function stageUploadedReceipt(companyId: string, actor: StagedReceiptActor, file: FormDataEntryValue | null): Promise<{ receipt: StagedReceiptView; duplicate: boolean }> {
  if (!file || typeof file === 'string') throw new ValidationError('Joignez un fichier (photo JPEG ou PNG, ou PDF).')
  if (file.size > RECEIPT_MAX_BYTES) throw new ValidationError(RECEIPT_FILE_MESSAGES.tooLarge)
  return stageReceipt(companyId, actor, { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, source: 'app' })
}
