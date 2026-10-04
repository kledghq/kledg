/**
 * The PDF of an invoice imported from Qonto. Kledg stores no file (it has no
 * file storage: receipts work the same way, lib/integrations/providers/qonto/
 * read-qonto-attachments.service.ts): it keeps Qonto's attachment id and
 * asks Qonto for a fresh signed URL on each read.
 *
 * Invariant: the attachment id comes from the stored invoice of the company,
 * never from the request; Qonto is asked with the company's own key; the URL
 * Qonto returns is fetched only through fetchQontoFile (Qonto file hosts,
 * public addresses, no redirect, timeout, byte budget).
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { limitBankCalls } from '@/lib/banking/guard'
import { fetchQontoFile } from '@/lib/integrations/providers/qonto/files'
import { getQontoCredentials } from '@/lib/integrations/providers/qonto/get-credentials'
import { QontoInvoicing } from '@/lib/integrations/providers/qonto/invoicing'

const NO_FILE = 'Aucun document n’est disponible pour cette facture.'

export async function readInvoiceAttachment(companyId: string, invoiceId: string, fetchImpl?: typeof fetch) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, companyId },
    select: { number: true, source: true, externalAttachmentId: true, attachmentFileName: true },
  })
  if (!invoice) throw new NotFoundError('Facture introuvable')
  if (invoice.source !== 'QONTO' || !invoice.externalAttachmentId) throw new NotFoundError(NO_FILE)
  await limitBankCalls(companyId)
  const { login, secretKey } = await getQontoCredentials(companyId)
  const file = await new QontoInvoicing(login, secretKey).getAttachmentFile(invoice.externalAttachmentId)
  if (!file) throw new NotFoundError(NO_FILE)
  const body = await fetchQontoFile(file.url, fetchImpl)
  const fileName = (file.file_name || invoice.attachmentFileName || `facture-${invoice.number}.pdf`).replace(/[^\w.\- ]+/g, '_')
  return { body, contentType: file.file_content_type || 'application/pdf', fileName }
}
