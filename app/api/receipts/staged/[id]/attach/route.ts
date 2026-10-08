import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { routeReceiptActor } from '@/lib/receipts/actor'
import { AttachReceiptBodySchema, attachStagedReceipt } from '@/lib/receipts/file-receipt.service'
import { companyOfStagedReceipt } from '@/lib/receipts/stage-receipt.service'

/**
 * POST /api/receipts/staged/[id]/attach { transactionId }
 * Attaches the receipt to a transaction of the company: sent to Qonto for a
 * Qonto account (within the company's limit of bank calls), else kept by
 * Kledg; idempotent.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfStagedReceipt), permission: { banking: ['reconcile'] }, body: AttachReceiptBodySchema },
  async (ctx) => NextResponse.json(await attachStagedReceipt(ctx.companyId, ctx.params.id as string, routeReceiptActor(ctx), ctx.body.transactionId)),
)
