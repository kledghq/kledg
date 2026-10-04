import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { ValidationError } from '@/lib/accounting/errors'
import { companyRoute, fromForm } from '@/lib/api/route'
import { assertFileSize } from '@/lib/api/files'
import { qontoClientFor } from '@/lib/integrations/providers/qonto/get-credentials'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/qonto/transactions/[id]/attachments/upload
 * Upload un attachment à une transaction
 * Documentation: https://docs.qonto.com/api-reference/business-api/expense-management/attachments-in-transactions/upload-an-attachment-to-a-transaction
 *
 * Qonto is called with the stored credentials of the company only, so only
 * transactions of the company's own Qonto organization can be targeted.
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

    // Vérifier le type de fichier (JPEG, PNG ou PDF uniquement)
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      throw new ValidationError('Type de fichier non autorisé. Seuls JPEG, PNG et PDF sont acceptés.')
    }

    const qontoClient = await qontoClientFor(companyId)

    await qontoClient.uploadTransactionAttachment(transactionId, file, randomUUID())

    return NextResponse.json({
      success: true,
      message: 'Attachment uploadé avec succès',
    })
  },
)
