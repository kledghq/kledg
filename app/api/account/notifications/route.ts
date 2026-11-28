import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authedRoute } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { receiptDigestOf, saveReceiptDigest } from '@/lib/receipts/digest/receipt-digest.service'

const NotificationsBody = z.strictObject({ receiptDigest: z.boolean({ error: 'Indiquez si vous voulez recevoir le récapitulatif.' }) })

/**
 * /api/account/notifications: the signed-in user's own emails, the weekly
 * email of missing receipts (lib/receipts/digest). Keyed by the session
 * user, so no request reaches another user's preference.
 */
export const GET = authedRoute({}, async ({ user }) => NextResponse.json(await receiptDigestOf(user.id), { headers: NO_CACHE_HEADERS }))

/** PUT { receiptDigest: boolean } */
export const PUT = authedRoute({ body: NotificationsBody, maxBodyBytes: 1024 }, async ({ request, user, body }) => {
  assertSameOrigin(request)
  return NextResponse.json(await saveReceiptDigest(user.id, body.receiptDigest))
})
