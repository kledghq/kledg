import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { CreateGrantBodySchema, createInvestmentGrant } from '@/lib/investment-grants/manage-investment-grants.service'
import { getYearEndInventory } from '@/lib/year-end/get-year-end-inventory.service'
import { FiscalYearQuerySchema } from '@/lib/year-end/schemas'

/** GET /api/investment-grants?companyId=&fiscalYearId=: the grants with their share of the fiscal year. */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] }, query: FiscalYearQuerySchema }, async ({ companyId, query }) => {
  const { fiscalYear, grants } = await getYearEndInventory(companyId, query.fiscalYearId)
  return NextResponse.json({ fiscalYear, grants }, { headers: NO_CACHE_HEADERS })
})

/** POST /api/investment-grants { companyId, label, amountCents, grantedOn, spreading, ... }: an investment grant. 201. */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: CreateGrantBodySchema },
  async ({ companyId, body }) => NextResponse.json(await createInvestmentGrant(companyId, body), { status: 201 }),
)
