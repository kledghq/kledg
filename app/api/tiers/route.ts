import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { CreateTiersBodySchema, createTiers, ListTiersQuerySchema, listTiers } from '@/lib/tiers/manage-tiers.service'

/** GET /api/tiers?companyId=&kind=&search=&limit=: customers and suppliers of the company, by name. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: ListTiersQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await listTiers(companyId, query), { headers: NO_CACHE_HEADERS }),
)

/** POST /api/tiers { companyId, kind, name, ... }: a customer or supplier (lib/tiers/manage-tiers.service.ts). */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: CreateTiersBodySchema },
  async ({ companyId, body }) => NextResponse.json(await createTiers(companyId, body), { status: 201 }),
)
