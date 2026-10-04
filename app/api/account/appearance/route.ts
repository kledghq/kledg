import { NextResponse } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { AppearanceBody, MAX_APPEARANCE_BODY_BYTES } from '@/lib/appearance/schema'
import { getAppearance, saveAppearance } from '@/lib/appearance/appearance.service'

/**
 * /api/account/appearance: the signed-in user's own chart colours. Keyed by
 * the session user, so no request reaches another user's preferences.
 */
export const GET = authedRoute({}, async ({ user }) =>
  NextResponse.json(await getAppearance(user), { headers: NO_CACHE_HEADERS }),
)

/** PUT { palette, base?, custom? }: saves a preset or a custom palette (#rrggbb colours per theme). */
export const PUT = authedRoute({ body: AppearanceBody, maxBodyBytes: MAX_APPEARANCE_BODY_BYTES }, async ({ request, user, body }) => {
  assertSameOrigin(request)
  return NextResponse.json(await saveAppearance(user, body))
})
