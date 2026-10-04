import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { routeActor } from '@/lib/expense-reports/actor'
import { CreateClaimantBodySchema, createClaimant, listClaimants } from '@/lib/expense-reports/manage-expense-claimants.service'

/** GET /api/expense-claimants?companyId=: the claimants of the company (one's own only without expenses:validate). */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] } },
  async (ctx) => NextResponse.json(await listClaimants(ctx.companyId, routeActor(ctx)), { headers: NO_CACHE_HEADERS }),
)

/** POST /api/expense-claimants { companyId, kind, name, personId?, userId?, accountCode?, auxiliaryAccountNumber? } */
export const POST = companyRoute(
  { company: fromBody(), permission: { expenses: ['validate'] }, body: CreateClaimantBodySchema },
  async ({ companyId, body }) => NextResponse.json(await createClaimant(companyId, body), { status: 201 }),
)
