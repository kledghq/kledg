import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { SidebarPreferencesBody } from '@/lib/navigation/sidebar-preferences'
import { getSidebarPreferences, saveSidebarPreferences } from '@/lib/navigation/sidebar-preferences.service'
import { sanitizeSidebarHidden } from '@/components/layout/sidebar-menu'

/**
 * /api/companies/[id]/sidebar-preferences: the signed-in user's own sidebar
 * menu in the company (docs/modes-et-menu.md). Any member may read and change
 * their own menu (a viewer included: it is a preference, not a change to the
 * books); it is keyed by the session user, so no request reaches another
 * user's. Unknown ids are ignored, on read and on write.
 */
const options = { company: fromParam('id'), permission: { settings: ['read'] } } as const

export const GET = companyRoute(options, async ({ user, companyId }) =>
  NextResponse.json(sanitizeSidebarHidden(await getSidebarPreferences(user.id, companyId)), { headers: NO_CACHE_HEADERS }),
)

/** PUT { hiddenItems, hiddenGroups }: replaces the menu; both empty shows the whole menu again. */
export const PUT = companyRoute({ ...options, body: SidebarPreferencesBody, maxBodyBytes: 16 * 1024 }, async ({ request, user, companyId, body }) => {
  assertSameOrigin(request)
  return NextResponse.json(await saveSidebarPreferences(user.id, companyId, sanitizeSidebarHidden(body)))
})
