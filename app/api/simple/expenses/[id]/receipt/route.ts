import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfTransaction } from '@/lib/api/resources'
import { uploadExpenseReceipt } from '@/lib/simple/upload-receipt.service'

/**
 * POST /api/simple/expenses/[id]/receipt (multipart: file)
 * Sends the receipt of a Qonto transaction to Qonto and records its
 * reference; other banks answer 400 with what to do instead. Counts in the
 * company's bank API limit (limitBankCalls).
 */
export const POST = companyRoute(
  // The wrapper caps the body at the upload limit before the form is parsed.
  { company: fromResource(companyOfTransaction), permission: { banking: ['reconcile'] }, multipart: true },
  async ({ request, params, companyId }) => {
    const form = await request.formData()
    return NextResponse.json(await uploadExpenseReceipt(companyId, params.id as string, form.get('file')), { status: 201 })
  },
)
