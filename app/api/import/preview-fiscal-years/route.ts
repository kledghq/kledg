import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { MAX_UPLOAD_BYTES } from '@/lib/api/files'
import { PreviewFecFiscalYearsBody, previewImportFiscalYears } from '@/lib/import/import-file.service'
import { enforceRateLimit } from '@/lib/rate-limit'

/**
 * POST /api/import/preview-fiscal-years { companyId, content, mapping? }: fiscal years the FEC covers.
 * The FEC content is sent inline: the body may be as large as an upload.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['read'] }, body: PreviewFecFiscalYearsBody, maxBodyBytes: MAX_UPLOAD_BYTES },
  async ({ companyId, user, body }) => {
    await enforceRateLimit('import', user.id)
    return NextResponse.json(await previewImportFiscalYears(companyId, body))
  },
)
