/**
 * Qonto receipts (pièces justificatives) of a company's transactions: the
 * list Qonto holds for a transaction and the file of one receipt.
 *
 * Invariant: Qonto is only queried with the stored credentials of the
 * company, for a transaction of the company; file URLs come from the stored
 * attachment or a fresh Qonto response, never from the request, and only
 * Qonto's file hosts are fetched (files.ts). Every read asks Qonto, so it
 * counts in the company's limit of bank calls (limitBankCalls), like the
 * other user triggered Qonto calls.
 */

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { transactionOfCompany } from '@/lib/api/resources'
import { limitBankCalls } from '@/lib/banking/guard'
import { readReceiptFile } from '@/lib/receipts/receipt-file-store'
import { getQontoCredentials, qontoClientFor } from './get-credentials'
import { QontoInvoicing } from './invoicing'
import { PROVIDER_FILE_BUDGET, assertDeclaredFileSize, fetchQontoFile, type FileBudget } from './files'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const RECEIPT_NOT_FOUND = 'Justificatif introuvable ou fichier non disponible'

/** Query of GET /api/qonto/transactions/[id]/attachments (Qonto pages hold at most 100 items). */
export const TransactionAttachmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
})

/**
 * The Qonto UUID of a transaction given by its UUID, or by its external id
 * in Kledg (then it must be a transaction of the company synced from Qonto).
 */
async function qontoTransactionUuid(companyId: string, ref: string): Promise<string> {
  if (UUID.test(ref)) return ref
  const transaction = await prisma.bankTransaction.findFirst({
    where: { ...transactionOfCompany(companyId), externalTransactionId: ref },
    select: { providerData: true },
  })
  if (!transaction?.providerData) throw new NotFoundError('Transaction introuvable')
  const id = (transaction.providerData as { id?: unknown }).id
  if (typeof id !== 'string' || !UUID.test(id)) throw new NotFoundError("Cette transaction n'est pas une opération Qonto.")
  return id
}

/** The receipts Qonto holds for a transaction of the company (Qonto's paged response). */
export async function listQontoTransactionAttachments(
  companyId: string,
  transactionRef: string,
  query: z.infer<typeof TransactionAttachmentsQuerySchema>,
) {
  if (!transactionRef) throw new ValidationError('Identifiant de transaction invalide.')
  const uuid = await qontoTransactionUuid(companyId, transactionRef)
  await limitBankCalls(companyId)
  return (await qontoClientFor(companyId)).listTransactionAttachments(uuid, { page: query.page, perPage: query.per_page })
}

/**
 * The client refers to an attachment by its Kledg id or by its provider
 * (Qonto) id, as returned by GET /api/transactions.
 */
function attachmentWhere(ref: string) {
  return { OR: [{ id: ref }, { externalAttachmentId: ref }] }
}

/** Company of a stored attachment (resolver of the receipt route). */
export function companyOfQontoAttachment(ref: string): Promise<{ companyId: string } | null> {
  return prisma.attachment.findFirst({ where: attachmentWhere(ref), select: { companyId: true } })
}

/** Query of GET /api/banking/attachments/[attachmentId]/proxy: the Qonto transaction of a receipt not synced yet. */
export const ReceiptQuerySchema = z.object({
  transactionUuid: z.string().max(200).optional(),
})

/**
 * A receipt listed by Qonto but not synchronized yet: allowed only for a
 * transaction of the company (the Qonto credentials used are the company's
 * own, so another organization's attachments can't be reached either).
 */
async function unsyncedAttachment(companyId: string, attachmentRef: string, transactionUuid: string | undefined) {
  if (!transactionUuid) throw new NotFoundError(RECEIPT_NOT_FOUND)
  const transaction = await prisma.bankTransaction.findFirst({
    where: { externalTransactionId: transactionUuid, ...transactionOfCompany(companyId) },
    select: { id: true },
  })
  if (!transaction) throw new NotFoundError(RECEIPT_NOT_FOUND)
  return {
    externalAttachmentId: attachmentRef,
    transactionUuid,
    fileName: 'justificatif',
    fileContentType: null as string | null,
    fileUrl: null as string | null,
    receiptFileId: null as string | null,
    providerData: null as Prisma.JsonValue,
    bankTransaction: null as { externalTransactionId: string } | null,
  }
}

export interface QontoReceipt {
  body: ArrayBuffer
  contentType: string
  fileName: string
}

/**
 * The file of a receipt of the company (PDF or image). A receipt Kledg
 * keeps itself (receiptFileId, lib/receipts) is read from the instance's
 * storage. Otherwise Qonto is asked for a
 * fresh signed URL (stored URLs expire after 30 minutes); the URL stored at
 * synchronization time is the fallback. A file larger than `budget`
 * (25 MB by default) is refused from Qonto's metadata when it gives the
 * size, else as soon as the download passes it.
 */
export async function readQontoReceipt(
  companyId: string,
  attachmentRef: string,
  transactionUuid?: string,
  budget: FileBudget = PROVIDER_FILE_BUDGET,
): Promise<QontoReceipt> {
  const stored =
    (await prisma.attachment.findFirst({
      where: { ...attachmentWhere(attachmentRef), companyId },
      select: {
        externalAttachmentId: true,
        transactionUuid: true,
        fileName: true,
        fileContentType: true,
        fileUrl: true,
        receiptFileId: true,
        providerData: true,
        bankTransaction: { select: { externalTransactionId: true } },
      },
    })) ?? (await unsyncedAttachment(companyId, attachmentRef, transactionUuid))
  const providerData = stored.providerData as { storedAt?: unknown } | null

  // A receipt Kledg keeps itself (a photo filed for a bank without receipt API, the receipt of an expense line): no bank call.
  // Its bytes come from the instance's storage (lib/receipts/receipt-file-store.ts), checked against their SHA-256.
  if (stored.receiptFileId) {
    const file = await readReceiptFile(companyId, stored.receiptFileId).catch((error: unknown) => {
      throw error instanceof NotFoundError ? new NotFoundError(RECEIPT_NOT_FOUND) : error
    })
    if (file.size > budget.maxBytes) throw budget.tooLarge(file.size)
    const body = file.bytes
    return { body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, contentType: file.contentType, fileName: stored.fileName || 'justificatif' }
  }

  const uuid = stored.transactionUuid || stored.bankTransaction?.externalTransactionId || null
  await limitBankCalls(companyId)
  let fileUrl: string | null = null
  let contentType = stored.fileContentType
  let fileName = stored.fileName

  if (uuid && stored.externalAttachmentId) {
    const { attachments } = await (await qontoClientFor(companyId)).listTransactionAttachments(uuid)
    const fresh = attachments?.find((a) => a.id === stored.externalAttachmentId)
    if (fresh?.url) {
      assertDeclaredFileSize(fresh.file_size, budget)
      fileUrl = fresh.url
      contentType = fresh.file_content_type || contentType
      fileName = fresh.file_name || fileName
    }
  }

  // A receipt stored at Qonto without a transaction (an expense line's receipt
  // sent as a supplier invoice, lib/receipts/offload-to-qonto.service.ts):
  // GET /v2/attachments/{id} gives a fresh signed URL.
  if (!uuid && stored.externalAttachmentId && providerData?.storedAt === 'qonto_supplier_invoice') {
    const { login, secretKey } = await getQontoCredentials(companyId)
    const fresh = await new QontoInvoicing(login, secretKey).getAttachmentFile(stored.externalAttachmentId)
    if (fresh) {
      fileUrl = fresh.url
      contentType = fresh.file_content_type || contentType
      fileName = fresh.file_name || fileName
    }
  }

  fileUrl ??= stored.fileUrl
  if (!fileUrl) throw new NotFoundError(RECEIPT_NOT_FOUND)
  return {
    body: await fetchQontoFile(fileUrl, undefined, budget),
    contentType: contentType || 'application/pdf',
    fileName: fileName || 'justificatif',
  }
}
