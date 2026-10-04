import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { listSimpleModeEntries, SimpleModeEntriesQuerySchema } from '@/lib/simple/simple-validation.service'

/**
 * GET /api/simple/entries?companyId=&status=&from=&to=&limit=
 * "Saisies du mode simple à valider": the entries confirmed in simple mode
 * (drafts to validate by default), with category, answers, note and lines,
 * and the validation summary of the period (this month by default).
 * Validation goes through POST /api/entries/bulk-validate.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: SimpleModeEntriesQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await listSimpleModeEntries(companyId, query), { headers: NO_CACHE_HEADERS }),
)
