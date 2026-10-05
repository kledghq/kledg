import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { LocalTaxesQuerySchema, loadLocalTaxes } from '@/lib/local-taxes/load-local-taxes.service'
import { SaveLocalTaxesBodySchema, saveLocalTaxes } from '@/lib/local-taxes/save-local-taxes.service'
import { LOCAL_TAXES_READ, LOCAL_TAXES_WRITE } from '@/lib/local-taxes/permissions'

/**
 * GET /api/companies/[id]/local-taxes?year=: the CFE (from the avis entered) and the CVAE (from the books) of a
 * calendar year, the current one by default, with their deadlines and statuses. Kledg prepares, the user pays
 * on impots.gouv.fr.
 */
export const GET = companyRoute(
  { company: fromParam(), permission: LOCAL_TAXES_READ, query: LocalTaxesQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await loadLocalTaxes(companyId, query), { headers: NO_CACHE_HEADERS }),
)

/** PUT /api/companies/[id]/local-taxes { year, cfe?: { totalCents, acompteCents?, noticeOn?, note? } | null, cvaeAdjustments? }. */
export const PUT = companyRoute(
  { company: fromParam(), permission: LOCAL_TAXES_WRITE, body: SaveLocalTaxesBodySchema },
  async ({ companyId, body, user }) => NextResponse.json(await saveLocalTaxes(companyId, body, { userId: user.id })),
)
