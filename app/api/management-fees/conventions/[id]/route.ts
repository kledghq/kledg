import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { companyOfManagementFeeConvention } from '@/lib/api/resources'
import { userGroupAccess } from '@/lib/management-fees/access'
import { ConventionBodySchema, deleteConvention, getConvention, updateConvention } from '@/lib/management-fees/manage-conventions.service'

const company = fromResource(companyOfManagementFeeConvention)

/** GET /api/management-fees/conventions/[id]: the convention, with the names of the subsidiaries the user may read. */
export const GET = companyRoute({ company, permission: { reports: ['read'] } }, async ({ companyId, params, user }) =>
  NextResponse.json(await getConvention(companyId, params.id as string, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)

/** PATCH /api/management-fees/conventions/[id]: replaces the convention (past billings keep their amounts). */
export const PATCH = companyRoute({ company, permission: { entries: ['create'] }, body: ConventionBodySchema }, async ({ companyId, params, user, body }) =>
  NextResponse.json(await updateConvention(companyId, params.id as string, body, userGroupAccess(user))),
)

/** DELETE /api/management-fees/conventions/[id]: only a convention never invoiced (409 otherwise). */
export const DELETE = companyRoute({ company, permission: { entries: ['create'] } }, async ({ companyId, params }) => {
  await deleteConvention(companyId, params.id as string)
  return new NextResponse(null, { status: 204 })
})
