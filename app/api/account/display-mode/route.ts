import { NextResponse } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { DisplayModeBody } from '@/lib/appearance/display-mode'
import { getDisplayMode, saveDisplayMode } from '@/lib/appearance/display-mode.service'

/**
 * /api/account/display-mode: the signed-in user's own display mode (simple
 * or expert, docs/mode-simple.md). Keyed by the session user, so no request
 * reaches another user's preference. Any role may change it: it is a
 * display preference and grants nothing.
 */
export const GET = authedRoute({}, async ({ user }) =>
  NextResponse.json(await getDisplayMode(user.id), { headers: NO_CACHE_HEADERS }),
)

/** PUT { mode: 'simple' | 'expert' } */
export const PUT = authedRoute({ body: DisplayModeBody, maxBodyBytes: 1024 }, async ({ request, user, body }) => {
  assertSameOrigin(request)
  return NextResponse.json(await saveDisplayMode(user, body.mode))
})
