import { NextResponse } from 'next/server'
import { companyRoute, fromForm } from '@/lib/api/route'
import { runStatementForm } from '@/lib/banking/import/import-statement.service'
import { enforceRateLimit } from '@/lib/rate-limit'

/**
 * Bank statement file import (CSV, Excel, OFX/QFX, camt.053).
 *
 * Multipart form: companyId, bankAccountId, file, mode ("preview" or
 * "import"), options, allowErrors, keep (StatementFormSchema). The preview
 * never writes; the import re-parses the same file with the same options and
 * recomputes duplicates, so client flags are never trusted
 * (lib/banking/import/import-statement.service.ts).
 */
export const POST = companyRoute(
  // The wrapper caps the body at the upload limit before the form is parsed.
  { company: fromForm(), permission: { banking: ['reconcile'] }, multipart: true },
  async ({ request, companyId, user }) => {
    await enforceRateLimit('import', user.id)
    return NextResponse.json(await runStatementForm(companyId, await request.formData()))
  },
)
