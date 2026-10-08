import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { routeReceiptActor } from '@/lib/receipts/actor'
import { companyOfStagedReceipt, discardStagedReceipt } from '@/lib/receipts/stage-receipt.service'

/** DELETE /api/receipts/staged/[id]: discards a receipt that was not filed (its file is deleted). */
export const DELETE = companyRoute({ company: fromResource(companyOfStagedReceipt), permission: { expenses: ['submit'] } }, async (ctx) =>
  NextResponse.json({ receipt: await discardStagedReceipt(ctx.companyId, ctx.params.id as string, routeReceiptActor(ctx)) }),
)
