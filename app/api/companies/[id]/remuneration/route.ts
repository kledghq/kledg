import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { loadRemuneration, RemunerationQuerySchema } from '@/lib/remuneration/load-remuneration.service'
import { REMUNERATION_READ } from '@/lib/remuneration/permissions'

/**
 * GET /api/companies/[id]/remuneration?fiscalYearId=&scenarioId=&basis=&inputs=: the "Rémunération et
 * dividendes" simulator of a fiscal year (defaults read from the books, the simulation, the saved
 * scenarios). An indicative simulation, never advice.
 */
export const GET = companyRoute(
  { company: fromParam(), permission: REMUNERATION_READ, query: RemunerationQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await loadRemuneration(companyId, query), { headers: NO_CACHE_HEADERS }),
)
