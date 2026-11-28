import { NextResponse } from 'next/server'
import { companyRoute, fromForm, fromQuery } from '@/lib/api/route'
import { routeReceiptActor } from '@/lib/receipts/actor'
import { guessReceiptFields, prefillStagedReceipt } from '@/lib/receipts/read/guess-receipt.service'
import { listPendingReceipts, stageUploadedReceipt, stagedReceiptView } from '@/lib/receipts/stage-receipt.service'

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
 * amount, date and merchant Kledg reads in it (an e-invoice's data, a
 * PDF's text) or in its file name, to prefill the form (`guess`), and
 * records them on the receipt as read, not confirmed (fieldsReadFrom).
 */
export const POST = companyRoute(
  // The wrapper caps the body at the upload limit before the form is parsed.
  { company: fromForm(), permission: { expenses: ['submit'] }, multipart: true },
  async (ctx) => {
    const file = (await ctx.request.formData()).get('file')
    const staged = await stageUploadedReceipt(ctx.companyId, routeReceiptActor(ctx), file)
    const upload = file && typeof file !== 'string' ? file : null
    const guess = await guessReceiptFields(ctx.companyId, {
      bytes: upload ? new Uint8Array(await upload.arrayBuffer()) : new Uint8Array(),
      // Read from the bytes when staged, never the declared type
      contentType: staged.receipt.contentType,
      fileName: upload?.name ?? staged.receipt.fileName,
    })
    // Recorded as read: the page searches the transaction at once, a later bank sync can find it
    const prefilled = staged.duplicate ? null : await prefillStagedReceipt(ctx.companyId, staged.receipt.id, guess)
    const receipt = prefilled ? stagedReceiptView(prefilled) : staged.receipt
    return NextResponse.json({ ...staged, receipt, guess }, { status: staged.duplicate ? 200 : 201 })
  },
)
