/**
 * "Ajouter le justificatif" of simple mode (docs/categories-simples.md).
 *
 * Kledg stores no file (docs/factures-et-tiers.md, Pièce jointe): receipts
 * live at the bank and Kledg keeps a reference (attachments table). For a
 * Qonto transaction, the file goes to Qonto's attachments API with the
 * company's own credentials, then the transaction's receipts are copied
 * back (uploadQontoReceipt, the receipts sync of
 * lib/integrations/providers/qonto/sync-attachments.ts for one transaction).
 * Other banks have no such API: the user keeps the receipt and hands it to
 * the accountant (Code de commerce art. L123-22: supporting documents are
 * kept ten years).
 *
 * The call reaches the bank: it counts in the company's bank API limit
 * (limitBankCalls, lib/rate-limit.ts).
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { assertFileSize } from '@/lib/api/files'
import { findOwned, transactionOfCompany } from '@/lib/api/resources'
import { limitBankCalls } from '@/lib/banking/guard'
import { uploadQontoReceipt } from '@/lib/integrations/providers/qonto/sync-attachments'
import { writeAuditLog } from '@/lib/audit'

export const RECEIPT_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'] as const

export const RECEIPT_MESSAGES = {
  missing: 'Joignez un fichier (photo JPEG ou PNG, ou PDF).',
  type: 'Type de fichier non accepté : une photo JPEG ou PNG, ou un PDF.',
  notQonto:
    "Votre banque ne permet pas d'envoyer le justificatif depuis Kledg : gardez la facture et transmettez-la à votre comptable.",
} as const

/** Sends the receipt of a transaction of the company to its bank, and records the reference. */
export async function uploadExpenseReceipt(companyId: string, transactionId: string, file: FormDataEntryValue | null): Promise<{ transactionId: string; receipts: number }> {
  const transaction = await findOwned(
    prisma.bankTransaction.findFirst({
      where: { id: transactionId, ...transactionOfCompany(companyId) },
      select: { id: true, bankAccount: { select: { bankConnection: { select: { provider: true } } } } },
    }),
    'Transaction introuvable',
  )
  if (!file || typeof file === 'string') throw new ValidationError(RECEIPT_MESSAGES.missing)
  assertFileSize(file)
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) throw new ValidationError(RECEIPT_MESSAGES.type)
  if (transaction.bankAccount.bankConnection.provider !== 'QONTO') throw new ValidationError(RECEIPT_MESSAGES.notQonto)

  await limitBankCalls(companyId)
  const { receipts } = await uploadQontoReceipt(companyId, transaction.id, file, randomUUID())
  await writeAuditLog('info', 'Simple mode receipt sent to the bank', {
    action: 'SIMPLE_MODE_RECEIPT_UPLOADED',
    companyId,
    metadata: { transactionId: transaction.id, receipts, contentType: file.type, size: file.size },
  })
  return { transactionId: transaction.id, receipts }
}
