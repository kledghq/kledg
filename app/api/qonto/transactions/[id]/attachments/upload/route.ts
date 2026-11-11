import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { ValidationError } from '@/lib/accounting/errors'
import { companyRoute, fromForm } from '@/lib/api/route'
import { assertFileSize } from '@/lib/api/files'
import { qontoClientFor } from '@/lib/integrations/providers/qonto/get-credentials'
import { qontoTransactionUuid } from '@/lib/integrations/providers/qonto/read-qonto-attachments.service'
import { limitBankCalls } from '@/lib/banking/guard'
import { checkReceiptFile, receiptFileName } from '@/lib/receipts/file-type'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/qonto/transactions/[id]/attachments/upload
 * Upload un attachment à une transaction
 * Documentation: https://docs.qonto.com/api-reference/business-api/expense-management/attachments-in-transactions/upload-an-attachment-to-a-transaction
 *
 * Qonto is called with the stored credentials of the company only, for a
 * transaction Kledg stored for the company (404 otherwise).
 */
export const POST = companyRoute(
  // The wrapper caps the body at the upload limit before the form is parsed.
  { company: fromForm(), permission: { banking: ['reconcile'] }, multipart: true },
  async ({ request, params, companyId }) => {
    const transactionId = params.id as string
    if (!transactionId || !UUID.test(transactionId)) {
      throw new ValidationError('Identifiant de transaction invalide.')
    }

    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || typeof file === 'string') {
      throw new ValidationError('Joignez un fichier (JPEG, PNG ou PDF).')
    }
    assertFileSize(file)

    // The type is read from the bytes, never from the browser's label (JPEG, PNG or PDF), like the staged receipts
    const bytes = new Uint8Array(await file.arrayBuffer())
    const check = checkReceiptFile(bytes)
    if (!check.ok) throw new ValidationError(check.message)

    const transactionUuid = await qontoTransactionUuid(companyId, transactionId)
    await limitBankCalls(companyId)
    const qontoClient = await qontoClientFor(companyId)
    const checked = new File([bytes], receiptFileName(file.name, check.contentType), { type: check.contentType })
    await qontoClient.uploadTransactionAttachment(transactionUuid, checked, randomUUID())

    return NextResponse.json({
      success: true,
      message: 'Attachment uploadé avec succès',
    })
  },
)
