import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { DashboardLayoutBody } from '@/lib/dashboard/layout'
import { getDashboardLayout, resetDashboardLayout, saveDashboardLayout } from '@/lib/dashboard/dashboard-layout.service'

/**
 * /api/dashboard/layout?companyId= : the signed-in user's own dashboard in
 * the company. Any member may read and change their own layout (a viewer
 * included: it is a preference, not a change to the books); the layout is
 * keyed by the session user, so no request reaches another user's.
 */
const options = { company: fromQuery(), permission: { reports: ['read'] } } as const

export const GET = companyRoute(options, async ({ user, companyId, roles, can }) =>
  NextResponse.json(await getDashboardLayout(user.id, companyId, { roles, can }), { headers: NO_CACHE_HEADERS }),
)

/** PUT { items: [{ id, size }] }: saves the layout (unknown widgets are ignored). */
export const PUT = companyRoute({ ...options, body: DashboardLayoutBody }, async ({ request, user, companyId, roles, can, body }) => {
  assertSameOrigin(request)
  return NextResponse.json(await saveDashboardLayout(user.id, companyId, body, { roles, can }))
})

/** DELETE: back to the default layout of the user's role. */
export const DELETE = companyRoute(options, async ({ request, user, companyId, roles, can }) => {
  assertSameOrigin(request)
  return NextResponse.json(await resetDashboardLayout(user.id, companyId, { roles, can }))
})
