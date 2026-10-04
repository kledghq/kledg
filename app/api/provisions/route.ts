import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { CreateProvisionBodySchema, createProvision } from '@/lib/provisions/manage-provisions.service'
import { getYearEndInventory } from '@/lib/year-end/get-year-end-inventory.service'
import { FiscalYearQuerySchema } from '@/lib/year-end/schemas'

/**
 * GET /api/provisions?companyId=&fiscalYearId=: the provisions and impairments of the
 * company as they stand at the closing of the fiscal year (opening balance, balance
 * required, movement booked and to book).
 */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] }, query: FiscalYearQuerySchema }, async ({ companyId, query }) => {
  const { fiscalYear, provisions } = await getYearEndInventory(companyId, query.fiscalYearId)
  return NextResponse.json({ fiscalYear, provisions }, { headers: NO_CACHE_HEADERS })
})

/** POST /api/provisions { companyId, category, label, justification, accountCode, ... }: a provision or an impairment. 201. */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: CreateProvisionBodySchema },
  async ({ companyId, body }) => NextResponse.json(await createProvision(companyId, body), { status: 201 }),
)
