/**
 * GET ?format=pdf|md: one document of the approval pack as a file (PDF to
 * sign, Markdown to edit). 400 with the list of what is missing until the
 * user filled it in; 404 for a document that is not part of the pack.
 */

import { z } from 'zod'
import { companyRoute, fromParam } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { NotFoundError } from '@/lib/accounting/errors'
import { enforceRateLimit } from '@/lib/rate-limit'
import { exportApprovalDocument } from '@/lib/approval/export-approval-document.service'
import { DOCUMENT_IDS, type DocumentId } from '@/lib/approval/pack'
import { DOCUMENT_FORMATS } from '@/lib/approval/schemas'

const DocumentQuery = z.object({ format: z.enum(DOCUMENT_FORMATS, { error: 'Format attendu : pdf ou md' }).optional().default('pdf') })

export const GET = companyRoute(
  { company: fromParam('id'), permission: { reports: ['export'] }, query: DocumentQuery },
  async ({ params, companyId, user, query }) => {
    const document = params.document as string
    if (!(DOCUMENT_IDS as readonly string[]).includes(document)) throw new NotFoundError('Document inconnu')
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportApprovalDocument(companyId, params.fiscalYearId as string, document as DocumentId, query.format))
  },
)
