/**
 * The document of an invoice:
 * - an imported e-invoice (source E_INVOICE): the file as received, kept by
 *   Kledg (receipt_files, import-e-invoice.service.ts), read through the
 *   storage of the instance, which checks its size and SHA-256;
 * - an invoice imported from Qonto: its PDF, fetched from Qonto. Kledg keeps
 *   Qonto's attachment id and asks Qonto for a fresh signed URL on each read.
 *
 * Invariant: the file id or attachment id comes from the stored invoice of
 * the company, never from the request; Qonto is asked with the company's
 * own key; the URL Qonto returns is fetched only through fetchQontoFile
 * (Qonto file hosts, public addresses, no redirect, timeout, byte budget).
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { limitBankCalls } from '@/lib/banking/guard'
import { PROVIDER_FILE_BUDGET, fetchQontoFile, type FileBudget } from '@/lib/integrations/providers/qonto/files'
import { readReceiptFile } from '@/lib/receipts/receipt-file-store'
import { getQontoCredentials } from '@/lib/integrations/providers/qonto/get-credentials'
import { QontoInvoicing } from '@/lib/integrations/providers/qonto/invoicing'

const NO_FILE = 'Aucun document n’est disponible pour cette facture.'

/** `budget`: the most bytes read from Qonto (25 MB by default; an MCP tool passes its own 5 MB). */
export async function readInvoiceAttachment(companyId: string, invoiceId: string, fetchImpl?: typeof fetch, budget: FileBudget = PROVIDER_FILE_BUDGET) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
    select: { number: true, source: true, externalAttachmentId: true, attachmentFileName: true, documentFileId: true },
  })
  if (!invoice) throw new NotFoundError('Facture introuvable')
  if (invoice.documentFileId) {
    const stored = await readReceiptFile(companyId, invoice.documentFileId)
    if (stored.size > budget.maxBytes) throw budget.tooLarge(stored.size)
    const fallback = `facture-${invoice.number ?? 'electronique'}${stored.contentType === 'application/pdf' ? '.pdf' : '.xml'}`
    return { body: new Uint8Array(stored.bytes), contentType: stored.contentType, fileName: (invoice.attachmentFileName || fallback).replace(/[^\w.\- ]+/g, '_') }
  }
  if (invoice.source !== 'QONTO' || !invoice.externalAttachmentId) throw new NotFoundError(NO_FILE)
  await limitBankCalls(companyId)
  const { login, secretKey } = await getQontoCredentials(companyId)
  const file = await new QontoInvoicing(login, secretKey).getAttachmentFile(invoice.externalAttachmentId)
  if (!file) throw new NotFoundError(NO_FILE)
  const body = await fetchQontoFile(file.url, fetchImpl, budget)
  const fileName = (file.file_name || invoice.attachmentFileName || `facture-${invoice.number}.pdf`).replace(/[^\w.\- ]+/g, '_')
  return { body, contentType: file.file_content_type || 'application/pdf', fileName }
}
