import { NextResponse } from 'next/server'
import { companyRoute, fromForm } from '@/lib/api/route'
import { runEInvoiceForm } from '@/lib/invoices/import-e-invoice.service'
import { enforceRateLimit } from '@/lib/rate-limit'

/**
 * POST /api/invoices/import-e-invoice: a received e-invoice (Factur-X PDF,
 * CII or UBL XML) recorded as a draft purchase invoice, its file kept.
 *
 * Multipart form: companyId, file, mode ("import" by default, "preview"
 * reads the file without writing). Importing the same file twice creates
 * nothing the second time (lib/invoices/import-e-invoice.service.ts).
 */
export const POST = companyRoute(
  // The wrapper caps the body at the upload limit before the form is parsed.
  { company: fromForm(), permission: { entries: ['create'] }, multipart: true },
  async ({ request, companyId, user }) => {
    await enforceRateLimit('import', user.id)
    return NextResponse.json(await runEInvoiceForm(companyId, await request.formData()))
  },
)
