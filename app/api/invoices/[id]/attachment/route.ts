import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { fileResponseHeaders } from '@/lib/api/files'
import { companyOfInvoice } from '@/lib/api/resources'
import { readInvoiceAttachment } from '@/lib/invoices/read-invoice-attachment.service'

/**
 * GET /api/invoices/[id]/attachment: the document of an invoice. An imported
 * e-invoice gives its file as received (kept by Kledg); an invoice imported
 * from Qonto gives its PDF, fetched from Qonto on demand (the URL comes from
 * Qonto, checked by fetchQontoFile, never from the request).
 */
export const GET = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['read'] } },
  async ({ companyId, params }) => {
    const file = await readInvoiceAttachment(companyId, params.id as string)
    return new NextResponse(file.body, { headers: fileResponseHeaders(file.contentType, file.fileName) })
  },
)
