import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { companyOfTiers } from '@/lib/api/resources'
import { deleteTiers, getTiers, UpdateTiersBodySchema, updateTiers } from '@/lib/tiers/manage-tiers.service'

/** GET /api/tiers/[id]: one customer or supplier. */
export const GET = companyRoute(
  { company: fromResource(companyOfTiers), permission: { entries: ['read'] } },
  async ({ companyId, params }) => NextResponse.json(await getTiers(companyId, params.id as string), { headers: NO_CACHE_HEADERS }),
)

/** PATCH /api/tiers/[id]: edits the tiers (its auxiliary number stays once it has invoices). */
export const PATCH = companyRoute(
  { company: fromResource(companyOfTiers), permission: { entries: ['update'] }, body: UpdateTiersBodySchema },
  async ({ companyId, params, body }) => NextResponse.json(await updateTiers(companyId, params.id as string, body)),
)

/** DELETE /api/tiers/[id]: refused (409) while the tiers has invoices. */
export const DELETE = companyRoute(
  { company: fromResource(companyOfTiers), permission: { entries: ['delete'] } },
  async ({ companyId, params }) => {
    await deleteTiers(companyId, params.id as string)
    return new NextResponse(null, { status: 204 })
  },
)
