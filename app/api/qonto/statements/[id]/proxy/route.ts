import { NextResponse } from 'next/server'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { fileResponseHeaders } from '@/lib/api/files'
import { qontoClientFor } from '@/lib/integrations/providers/qonto/get-credentials'
import { fetchQontoFile } from '@/lib/integrations/providers/qonto/files'
import { limitBankCalls } from '@/lib/banking/guard'

/** Qonto ids are UUIDs: never let a path segment reach the Qonto API path. */
const QONTO_ID = /^[A-Za-z0-9-]{1,100}$/

/**
 * GET /api/qonto/statements/[id]/proxy
 * Serves the PDF of a Qonto bank statement with safe headers.
 *
 * The statement is read with the stored credentials of the company, so it
 * belongs to the company's own Qonto organization, and the file URL fetched
 * upstream comes from that Qonto response (never from the request), checked
 * against Qonto's file hosts (lib/integrations/providers/qonto/files.ts).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ params, companyId }) => {
    const statementId = params.id as string
    if (!statementId || !QONTO_ID.test(statementId)) {
      throw new ValidationError('Identifiant de relevé invalide.')
    }

    await limitBankCalls(companyId)
    const { statement } = await (await qontoClientFor(companyId)).getStatement(statementId)
    if (!statement?.file?.file_url) {
      throw new NotFoundError('Relevé non trouvé ou fichier non disponible')
    }

    // Qonto file URLs are signed and valid for 30 minutes
    const file = await fetchQontoFile(statement.file.file_url)
    return new NextResponse(file, {
      headers: fileResponseHeaders(
        statement.file.file_content_type || 'application/pdf',
        statement.file.file_name || `releve-${statementId}.pdf`,
      ),
    })
  },
)
