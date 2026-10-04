import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { reclassifyDoubtfulReceivable, ReclassifyBodySchema } from '@/lib/provisions/doubtful-receivables.service'

/** POST /api/provisions/doubtful-receivables/reclassify { companyId, fiscalYearId, tiersCode }: draft entry from 411 to 416. 201. */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: ReclassifyBodySchema },
  async ({ companyId, body }) => NextResponse.json(await reclassifyDoubtfulReceivable(companyId, body), { status: 201 }),
)
