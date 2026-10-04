import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { prepareYearEndEntries } from '@/lib/year-end/prepare-year-end-entries.service'
import { PrepareYearEndBodySchema } from '@/lib/year-end/schemas'

/**
 * POST /api/year-end/entries { companyId, fiscalYearId }: prepares the dotations, reprises and
 * grant transfers of the closing as draft entries (nothing validated). Idempotent.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: PrepareYearEndBodySchema },
  async ({ companyId, body }) => NextResponse.json(await prepareYearEndEntries(companyId, body.fiscalYearId), { status: 201 }),
)
