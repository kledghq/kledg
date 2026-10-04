import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { fileResponseHeaders } from '@/lib/api/files'
import { companyOfInvoice } from '@/lib/api/resources'
import { readInvoiceAttachment } from '@/lib/invoices/read-invoice-attachment.service'

/**
 * GET /api/invoices/[id]/attachment: the PDF of an invoice imported from
 * Qonto, fetched from Qonto on demand (no file is stored; the URL comes from
 * Qonto, checked by fetchQontoFile, never from the request).
 */
export const GET = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['read'] } },
  async ({ companyId, params }) => {
    const file = await readInvoiceAttachment(companyId, params.id as string)
    return new NextResponse(file.body, { headers: fileResponseHeaders(file.contentType, file.fileName) })
  },
)
