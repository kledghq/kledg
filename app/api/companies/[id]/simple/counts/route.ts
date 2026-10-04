import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { loadSimpleCounts } from '@/lib/simple/count-expenses-to-check.service'

/** Counts shown in the simple navigation (docs/mode-simple.md): bank debits still to check. */
export const GET = companyRoute({ company: fromParam('id'), permission: { banking: ['read'] } }, async ({ companyId }) =>
  NextResponse.json(await loadSimpleCounts(companyId), { headers: NO_CACHE_HEADERS }),
)
