/**
 * Receipts of expense lines handed to Qonto (docs/justificatifs-photo.md,
 * Qonto). A receipt paid with a personal card or cash has no Qonto
 * transaction to carry it; Qonto's only endpoint that stores such a file
 * and lets Kledg read it back is the supplier invoices upload
 * (QONTO_RECEIPT_CAPABILITIES.canStoreUnmatchedReceipts,
 * lib/integrations/providers/qonto/supplier-invoices.ts).
 *
 * Off unless the instance opts in with
 * KLEDG_QONTO_EXPENSE_RECEIPTS=supplier_invoices: Qonto lists the file
 * among the supplier invoices "to review" (someone could take it for a bill
 * to pay) and has no endpoint to delete it, so the choice is the
 * operator's.
 *
 * When on, for a company connected to Qonto, the receipt of a line of a
 * VALIDATED expense report (a brouillon may still lose the line, and the
 * copy at Qonto could not be removed):
 * 1. is uploaded with an idempotency key derived from the company and the
 *    file's SHA-256 (a retry does not create a second invoice), without
 *    Qonto's attachment matcher (a personal payment has no transaction);
 * 2. is read back: the invoice, its attachment, the file's bytes, whose
 *    SHA-256 must be the file's;
 * 3. only then the attachment points to Qonto's attachment
 *    (externalAttachmentId, providerData.qontoSupplierInvoiceId) instead of
 *    Kledg's file, and Kledg's copy is deleted (receipt_files row and its
 *    object). Any failure before keeps Kledg's copy; the next run tries again.
 * The receipt proxy then reads the file from Qonto (readQontoReceipt).
 *
 * Runs after the daily bank sync of each Qonto company (at most
 * QONTO_OFFLOAD_BATCH receipts per run, within the company's bank API
 * limit) and from `pnpm receipts:migrate-storage --qonto`.
 */

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { writeAuditLog } from '@/lib/audit'
import { NotFoundError } from '@/lib/accounting/errors'
import { limitBankCalls } from '@/lib/banking/guard'
import { QONTO_RECEIPT_CAPABILITIES } from '@/lib/integrations/providers/qonto/capabilities'
import { getQontoCredentials } from '@/lib/integrations/providers/qonto/get-credentials'
import { QontoSupplierInvoices } from '@/lib/integrations/providers/qonto/supplier-invoices'
import { QontoInvoicing } from '@/lib/integrations/providers/qonto/invoicing'
import { fetchQontoFile } from '@/lib/integrations/providers/qonto/files'
import { deleteUnreferencedReceiptFiles, readReceiptFile, sha256Hex } from './receipt-file-store'

export const QONTO_OFFLOAD_BATCH = 20

type Env = Record<string, string | undefined>

/** Whether the instance hands expense receipts to Qonto (opt in, see above). */
export function qontoExpenseReceiptsEnabled(env: Env = process.env): boolean {
  return QONTO_RECEIPT_CAPABILITIES.canStoreUnmatchedReceipts && env.KLEDG_QONTO_EXPENSE_RECEIPTS?.trim().toLowerCase() === 'supplier_invoices'
}

/** The Qonto calls of an offload (stubbed in the tests). */
export interface QontoReceiptStore {
  upload(file: File, idempotencyKey: string): Promise<{ kind: 'created'; invoiceId: string } | { kind: 'refused'; codes: string[] }>
  /** The bytes of the invoice's file as Qonto serves them, or null while Qonto has not attached it yet. */
  readBack(invoiceId: string): Promise<{ attachmentId: string; bytes: Uint8Array } | null>
}

async function qontoStoreFor(companyId: string): Promise<QontoReceiptStore> {
  const { login, secretKey } = await getQontoCredentials(companyId)
  const invoices = new QontoSupplierInvoices(login, secretKey)
  const attachments = new QontoInvoicing(login, secretKey)
  return {
    async upload(file, idempotencyKey) {
      const result = await invoices.uploadSupplierInvoice(file, idempotencyKey, { skipMatcher: true })
      return result.kind === 'created' ? { kind: 'created', invoiceId: result.invoice.id } : result
    },
    async readBack(invoiceId) {
      const invoice = await invoices.getSupplierInvoice(invoiceId)
      if (!invoice?.attachment_id) return null
      const file = await attachments.getAttachmentFile(invoice.attachment_id)
      if (!file) return null
      return { attachmentId: invoice.attachment_id, bytes: new Uint8Array(await fetchQontoFile(file.url)) }
    },
  }
}

/** Qonto's idempotency key of a file of a company: a UUID derived from both, the same at every retry. */
export function supplierInvoiceKey(companyId: string, sha256: string): string {
  const h = createHash('sha256').update(`kledg:qonto-supplier-invoice:${companyId}:${sha256}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Expense receipts of the company that Kledg keeps and Qonto could keep instead. */
function offloadable(companyId: string): Prisma.AttachmentWhereInput {
  return {
    companyId,
    bankTransactionId: null,
    receiptFileId: { not: null },
    expenseLines: { some: {}, every: { report: { status: 'VALIDATED' } } },
  }
}

export type OffloadOutcome = 'sent' | 'refused' | 'not_readable_yet' | 'mismatch' | 'skipped'

/** Hands one attachment's file to Qonto (the steps above). Never throws for a Qonto refusal: Kledg keeps its copy. */
export async function offloadReceiptToQonto(companyId: string, attachmentId: string, store?: QontoReceiptStore): Promise<OffloadOutcome> {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, ...offloadable(companyId) },
    select: { id: true, fileName: true, receiptFileId: true, providerData: true, receiptFile: { select: { sha256: true } } },
  })
  if (!attachment?.receiptFileId || !attachment.receiptFile) return 'skipped'
  const fileId = attachment.receiptFileId
  const file = await readReceiptFile(companyId, fileId)
  const sha256 = attachment.receiptFile.sha256
  const qonto = store ?? (await qontoStoreFor(companyId))

  await limitBankCalls(companyId)
  const uploaded = await qonto.upload(new File([file.bytes as BlobPart], attachment.fileName || 'justificatif', { type: file.contentType }), supplierInvoiceKey(companyId, sha256))
  if (uploaded.kind === 'refused') {
    logger.warn('[Receipts] Qonto refused an expense receipt as a supplier invoice; Kledg keeps it', { companyId, attachmentId, codes: uploaded.codes })
    return 'refused'
  }
  const back = await qonto.readBack(uploaded.invoiceId)
  if (!back) return 'not_readable_yet'
  if (back.bytes.byteLength !== file.size || sha256Hex(back.bytes) !== sha256) {
    logger.error('[Receipts] Qonto served a different file than the one sent; Kledg keeps its copy', { companyId, attachmentId, supplierInvoiceId: uploaded.invoiceId })
    return 'mismatch'
  }

  const previous = attachment.providerData && typeof attachment.providerData === 'object' && !Array.isArray(attachment.providerData) ? attachment.providerData : {}
  const switched = await prisma.$transaction(async (tx) => {
    const updated = await tx.attachment.updateMany({
      where: { id: attachment.id, companyId, receiptFileId: fileId },
      data: {
        receiptFileId: null,
        externalAttachmentId: back.attachmentId,
        providerData: { ...previous, storedAt: 'qonto_supplier_invoice', qontoSupplierInvoiceId: uploaded.invoiceId },
      },
    })
    if (updated.count === 0) return false
    // The staged receipt that became this line no longer holds Kledg's file.
    await tx.stagedReceipt.updateMany({ where: { companyId, fileId, attachmentId: attachment.id }, data: { fileId: null } })
    return true
  })
  if (!switched) return 'skipped'
  await deleteUnreferencedReceiptFiles(companyId, fileId)
  await writeAuditLog('info', 'Expense receipt stored at Qonto', {
    action: 'RECEIPT_STORED_AT_QONTO',
    companyId,
    metadata: { attachmentId: attachment.id, supplierInvoiceId: uploaded.invoiceId, qontoAttachmentId: back.attachmentId },
  })
  return 'sent'
}

/**
 * Hands up to `limit` expense receipts of a Qonto company to Qonto (off
 * unless enabled). Stops at the first error that is not Qonto refusing one
 * receipt (bank API limit, Qonto down): the rest waits for the next run.
 */
export async function offloadExpenseReceiptsToQonto(companyId: string, options: { limit?: number; store?: QontoReceiptStore; env?: Env } = {}): Promise<Record<OffloadOutcome, number>> {
  const counts: Record<OffloadOutcome, number> = { sent: 0, refused: 0, not_readable_yet: 0, mismatch: 0, skipped: 0 }
  if (!qontoExpenseReceiptsEnabled(options.env)) return counts
  let store = options.store
  if (!store) {
    try {
      store = await qontoStoreFor(companyId)
    } catch (error) {
      if (error instanceof NotFoundError) return counts
      throw error
    }
  }
  const attachments = await prisma.attachment.findMany({ where: offloadable(companyId), select: { id: true }, orderBy: { createdAt: 'asc' }, take: options.limit ?? QONTO_OFFLOAD_BATCH })
  for (const { id } of attachments) {
    try {
      counts[await offloadReceiptToQonto(companyId, id, store)]++
    } catch (error) {
      logger.warn('[Receipts] Handing expense receipts to Qonto stopped; Kledg keeps them', { companyId, error: error instanceof Error ? error.message : String(error) })
      break
    }
  }
  return counts
}
