import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { InvoiceNumberingBodySchema } from '@/lib/invoices/numbering/settings'
import { getInvoiceNumbering, updateInvoiceNumbering } from '@/lib/invoices/numbering/manage-numbering-settings.service'

/** GET /api/companies/[id]/invoice-numbering: numbering of sales invoices, the next numbers and whether invoices are created in Qonto. */
export const GET = companyRoute(
  { company: fromParam(), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await getInvoiceNumbering(companyId), { headers: NO_CACHE_HEADERS }),
)

/** PUT /api/companies/[id]/invoice-numbering { settings, nextNumbers? }: changes the numbering (CGI ann. II art. 242 nonies A, I, 7°). */
export const PUT = companyRoute(
  { company: fromParam(), permission: { settings: ['update'] }, body: InvoiceNumberingBodySchema },
  async ({ companyId, body }) => NextResponse.json(await updateInvoiceNumbering(companyId, body)),
)
