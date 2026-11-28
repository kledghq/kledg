import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { receiptInboxOf, renewReceiptInbox } from '@/lib/receipts/inbound/inbox.service'

/**
 * GET /api/receipts/inbox?companyId=
 * The company's receipt email address (docs/justificatifs-email.md): whether
 * the instance receives receipt emails, and the address once created. Read
 * by the members who file every receipt: whoever knows it can send some.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { banking: ['reconcile'] } }, async (ctx) =>
  NextResponse.json(await receiptInboxOf(ctx.companyId)),
)

/**
 * POST /api/receipts/inbox { companyId }
 * Creates the address, or replaces it with a new one: the former address
 * stops working at once. Company settings.
 */
export const POST = companyRoute({ company: fromBody(), permission: { settings: ['update'] } }, async (ctx) =>
  NextResponse.json(await renewReceiptInbox(ctx.companyId, ctx.user.id)),
)
