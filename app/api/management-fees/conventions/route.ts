import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { ConventionBodySchema, createConvention, listConventions } from '@/lib/management-fees/manage-conventions.service'

/** GET /api/management-fees/conventions?companyId=: the management fee conventions of the holding. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] } },
  async ({ companyId, user }) => NextResponse.json(await listConventions(companyId, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)

/**
 * POST /api/management-fees/conventions { companyId, label, pricing, ..., subsidiaries }:
 * a convention of the holding; each subsidiary must record the holding as a
 * shareholder and be readable by the user (lib/management-fees/access.ts).
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: ConventionBodySchema },
  async ({ companyId, user, body }) => NextResponse.json(await createConvention(companyId, body, userGroupAccess(user)), { status: 201 }),
)
