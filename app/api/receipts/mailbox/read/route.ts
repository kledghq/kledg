import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { enforceRateLimit } from '@/lib/rate-limit'
import { readMailbox } from '@/lib/receipts/mailbox/mailbox.service'

/**
 * POST /api/receipts/mailbox/read { companyId }
 * Reads the new messages of the company's mailbox now ("Relever
 * maintenant"), like the nightly run: their receipts are staged, read and
 * matched, never attached.
 */
export const POST = companyRoute({ company: fromBody(), permission: { banking: ['reconcile'] } }, async (ctx) => {
  await enforceRateLimit('mailbox-connect', ctx.companyId)
  return NextResponse.json(await readMailbox(ctx.companyId))
})
