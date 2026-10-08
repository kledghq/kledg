import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { routeReceiptActor } from '@/lib/receipts/actor'
import { MatchReceiptBodySchema, matchStagedReceipt } from '@/lib/receipts/file-receipt.service'
import { companyOfStagedReceipt } from '@/lib/receipts/stage-receipt.service'

/**
 * POST /api/receipts/staged/[id]/match { fields?: { amountCents, currency, date, merchant, vatLines, paymentHint } }
 * Records the fields the user confirmed and finds the bank transaction:
 * matched, candidates or none (with the expense report proposal).
 */
export const POST = companyRoute(
  { company: fromResource(companyOfStagedReceipt), permission: { banking: ['read'] }, body: MatchReceiptBodySchema },
  async (ctx) => NextResponse.json(await matchStagedReceipt(ctx.companyId, ctx.params.id as string, routeReceiptActor(ctx), ctx.body.fields)),
)
