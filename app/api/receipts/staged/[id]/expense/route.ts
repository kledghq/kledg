import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { routeActor } from '@/lib/expense-reports/actor'
import { routeReceiptActor } from '@/lib/receipts/actor'
import { ExpenseFromReceiptBodySchema, expenseFromStagedReceipt } from '@/lib/receipts/file-receipt.service'
import { companyOfStagedReceipt } from '@/lib/receipts/stage-receipt.service'

/**
 * POST /api/receipts/staged/[id]/expense { category?, label? }
 * Adds the receipt as a line of the user's own brouillon of the month (or a
 * new one), never submitted: the user finishes it on its page.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfStagedReceipt), permission: { expenses: ['submit'] }, body: ExpenseFromReceiptBodySchema.optional().default({}) },
  async (ctx) => {
    const result = await expenseFromStagedReceipt(ctx.companyId, ctx.params.id as string, routeReceiptActor(ctx), routeActor(ctx), ctx.body)
    return NextResponse.json(result, { status: result.alreadyDone ? 200 : 201 })
  },
)
