import { NextResponse } from 'next/server'
import { companyRoute, fromForm } from '@/lib/api/route'
import { importAccountingFile } from '@/lib/import/import-file.service'
import { enforceRateLimit } from '@/lib/rate-limit'

/**
 * POST /api/import (multipart: companyId, file, type fec|csv|excel, mapping?,
 * accountMapping?, journalMapping?, cleanEntryNumbers?): imports the file and
 * returns the importer's report (entries created, refused entries, warnings).
 * The wrapper caps the body at the upload limit before the form is parsed.
 */
export const POST = companyRoute(
  { company: fromForm(), permission: { entries: ['create'], ledger: ['manage'] }, multipart: true },
  async ({ request, companyId, user }) => {
    await enforceRateLimit('import', user.id)
    return NextResponse.json(await importAccountingFile(companyId, await request.formData()))
  },
)
