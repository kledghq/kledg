import { NextResponse } from 'next/server'
import { companyRoute, fromForm, fromQuery } from '@/lib/api/route'
import { routeReceiptActor } from '@/lib/receipts/actor'
import { fieldsFromFileName } from '@/lib/receipts/file-name-fields'
import { listPendingReceipts, stageUploadedReceipt } from '@/lib/receipts/stage-receipt.service'

/**
 * GET /api/receipts/staged?companyId=
 * The receipts the user dropped on the Justificatifs page and has not filed
 * yet (docs/justificatifs-photo.md).
 */
export const GET = companyRoute({ company: fromQuery(), permission: { expenses: ['submit'] } }, async (ctx) =>
  NextResponse.json({ receipts: await listPendingReceipts(ctx.companyId, routeReceiptActor(ctx)) }),
)

/**
 * POST /api/receipts/staged (multipart: companyId, file)
 * Stages a photo or a PDF of a receipt: type checked from its bytes, 5 MB
 * at most, once per content in the company. Answers the receipt and the
 * date, amount and merchant its file name gives, to prefill the form.
 */
export const POST = companyRoute(
  // The wrapper caps the body at the upload limit before the form is parsed.
  { company: fromForm(), permission: { expenses: ['submit'] }, multipart: true },
  async (ctx) => {
    const file = (await ctx.request.formData()).get('file')
    const staged = await stageUploadedReceipt(ctx.companyId, routeReceiptActor(ctx), file)
    const guess = fieldsFromFileName(file && typeof file !== 'string' ? file.name : staged.receipt.fileName)
    return NextResponse.json({ ...staged, guess }, { status: staged.duplicate ? 200 : 201 })
  },
)
