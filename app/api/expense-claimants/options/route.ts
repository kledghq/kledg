import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { listClaimantOptions } from '@/lib/expense-reports/manage-expense-claimants.service'

/** GET /api/expense-claimants/options?companyId=: persons and members a claimant can be linked to. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { expenses: ['validate'] } },
  async ({ companyId }) => NextResponse.json(await listClaimantOptions(companyId), { headers: NO_CACHE_HEADERS }),
)
