/**
 * Copies the receipts Qonto holds for the company's Qonto debits into
 * Attachment rows (file name, type, signed URL; the file itself stays at
 * Qonto and is served through the attachment proxy).
 *
 * Only transactions of Qonto bank accounts are asked about: lines from
 * another provider or a statement file have no Qonto id. A receipt is stored
 * once per company (externalAttachmentId), at most two per transaction, so
 * running the sync again only refreshes what is there. A Qonto rate limit
 * stops the run with a French message; other failures are counted per
 * transaction and logged.
 */

import type { Prisma } from '@prisma/client'
import { NotFoundError, RateLimitError } from '@/lib/accounting/errors'
import { errorReason } from '@/lib/banking/errors'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { qontoClientFor } from './get-credentials'
import type { QontoTransactionAttachment } from './types'
import { plural } from '@/lib/utils/plural'

const BATCH_SIZE = 100
const MAX_ATTACHMENTS_PER_TRANSACTION = 2

export interface AttachmentSyncResult {
  success: boolean
  created: number
  updated: number
  skipped: number
  totalProcessed: number
  rateLimitReached: boolean
  errors?: string[]
  message: string
}

/** Qonto's transaction uuid (attachments API), stored in providerData.id by the sync. */
function qontoTransactionUuid(providerData: Prisma.JsonValue, fallback: string): string {
  const id = providerData && typeof providerData === 'object' && !Array.isArray(providerData) ? providerData.id : undefined
  return typeof id === 'string' && id ? id : fallback
}

function attachmentFields(attachment: QontoTransactionAttachment, transactionUuid: string) {
  const size = Number.parseInt(String(attachment.file_size ?? ''), 10)
  return {
    transactionUuid,
    fileName: attachment.file_name,
    fileSize: Number.isFinite(size) ? size : null,
    fileContentType: attachment.file_content_type || null,
    fileUrl: attachment.url || null,
    providerData: {
      id: attachment.id,
      file_name: attachment.file_name,
      file_size: attachment.file_size,
      file_content_type: attachment.file_content_type,
      file_url: attachment.url,
      created_at: attachment.created_at,
      transaction_uuid: transactionUuid,
      probative_attachment: attachment.probative_attachment ?? null,
    },
  }
}

type QontoClient = Awaited<ReturnType<typeof qontoClientFor>>

interface SyncedTransaction {
  id: string
  externalTransactionId: string
  providerData: Prisma.JsonValue
  attachments: Array<{ id: string }>
}

/** Copies the receipts Qonto holds for one transaction (throws on a Qonto failure). */
async function storeQontoAttachments(
  companyId: string,
  integrationId: string,
  qonto: QontoClient,
  transaction: SyncedTransaction,
): Promise<{ created: number; updated: number; skipped: number }> {
  const transactionUuid = qontoTransactionUuid(transaction.providerData, transaction.externalTransactionId)
  const { attachments = [] } = await qonto.listTransactionAttachments(transactionUuid)
  if (attachments.length === 0) return { created: 0, updated: 0, skipped: 1 }
  const existing = new Map(
    (
      await prisma.attachment.findMany({
        where: { companyId, externalAttachmentId: { in: attachments.map((a) => a.id) } },
        select: { id: true, externalAttachmentId: true },
      })
    ).map((a) => [a.externalAttachmentId, a.id]),
  )
  let created = 0
  let updated = 0
  let count = transaction.attachments.length
  for (const attachment of attachments) {
    const fields = attachmentFields(attachment, transactionUuid)
    const existingId = existing.get(attachment.id)
    if (existingId) {
      await prisma.attachment.update({ where: { id: existingId }, data: { ...fields, bankTransactionId: transaction.id } })
      updated++
    } else if (count < MAX_ATTACHMENTS_PER_TRANSACTION) {
      await prisma.attachment.create({
        data: { ...fields, companyId, integrationId, bankTransactionId: transaction.id, externalAttachmentId: attachment.id },
      })
      created++
      count++
    }
  }
  return { created, updated, skipped: 0 }
}

/**
 * Sends a receipt to Qonto for one Qonto transaction of the company, then
 * copies the receipts Qonto holds for it (simple mode, "Ajouter le
 * justificatif"). The file is never stored by Kledg. Returns the number of
 * receipts the transaction has afterwards.
 */
export async function uploadQontoReceipt(companyId: string, transactionId: string, file: File | Blob, idempotencyKey: string): Promise<{ receipts: number }> {
  const integration = await prisma.integration.findFirst({
    where: { companyId, provider: 'QONTO', status: 'active', type: 'BANKING' },
    select: { id: true },
  })
  if (!integration) throw new NotFoundError("Qonto n'est pas connecté pour cette société : connectez-le depuis la page Banque.")
  const transaction = await prisma.bankTransaction.findFirst({
    where: { id: transactionId, bankAccount: { bankConnection: { companyId, provider: 'QONTO' } } },
    select: { id: true, externalTransactionId: true, providerData: true, attachments: { select: { id: true } } },
  })
  if (!transaction) throw new NotFoundError('Transaction Qonto introuvable')
  const qonto = await qontoClientFor(companyId)
  await qonto.uploadTransactionAttachment(qontoTransactionUuid(transaction.providerData, transaction.externalTransactionId), file, idempotencyKey)
  try {
    await storeQontoAttachments(companyId, integration.id, qonto, transaction)
  } catch (error) {
    // The receipt is at Qonto: the next sync copies it.
    logger.warn('[Qonto] Receipt sent, its copy will come with the next sync', { transactionId, reason: errorReason(error) })
  }
  return { receipts: await prisma.attachment.count({ where: { companyId, bankTransactionId: transaction.id } }) }
}

export async function syncQontoAttachments(companyId: string): Promise<AttachmentSyncResult> {
  const integration = await prisma.integration.findFirst({
    where: { companyId, provider: 'QONTO', status: 'active', type: 'BANKING' },
    select: { id: true },
  })
  if (!integration) throw new NotFoundError("Qonto n'est pas connecté pour cette société : connectez-le depuis la page Banque.")
  const qonto = await qontoClientFor(companyId)

  let created = 0
  let updated = 0
  let skipped = 0
  let failed = 0
  let rateLimitReached = false
  let cursor: string | undefined

  while (!rateLimitReached) {
    const batch = await prisma.bankTransaction.findMany({
      where: { side: 'debit', bankAccount: { bankConnection: { companyId, provider: 'QONTO' } } },
      select: { id: true, externalTransactionId: true, providerData: true, attachments: { select: { id: true } } },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (batch.length === 0) break
    cursor = batch[batch.length - 1].id

    for (const transaction of batch) {
      if (transaction.attachments.length >= MAX_ATTACHMENTS_PER_TRANSACTION) continue
      try {
        const counts = await storeQontoAttachments(companyId, integration.id, qonto, transaction)
        created += counts.created
        updated += counts.updated
        skipped += counts.skipped
      } catch (error) {
        if (error instanceof RateLimitError) {
          rateLimitReached = true
          break
        }
        failed++
        logger.error('[Qonto] Receipt sync failed for a transaction', { transactionId: transaction.id, reason: errorReason(error) })
      }
    }
    if (batch.length < BATCH_SIZE) break
  }

  const errors: string[] = []
  if (rateLimitReached) errors.push('Qonto limite le nombre de requêtes : la synchronisation des justificatifs a été interrompue. Réessayez dans quelques minutes.')
  if (failed > 0) errors.push(`Les justificatifs de ${plural(failed, 'transaction')} n'ont pas pu être lus chez Qonto.`)
  return {
    success: !rateLimitReached,
    created,
    updated,
    skipped,
    totalProcessed: created + updated + skipped,
    rateLimitReached,
    errors: errors.length > 0 ? errors : undefined,
    message: rateLimitReached ? errors[0] : 'Justificatifs synchronisés.',
  }
}
