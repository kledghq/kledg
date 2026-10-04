import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { companyOfInvoice } from '@/lib/api/resources'
import { deleteInvoice, getInvoice, UpdateInvoiceBodySchema, updateInvoice } from '@/lib/invoices/manage-invoices.service'

/** GET /api/invoices/[id]: the invoice with its lines, VAT breakdown, entry, payments and status. */
export const GET = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['read'] } },
  async ({ companyId, params }) => NextResponse.json(await getInvoice(companyId, params.id as string), { headers: NO_CACHE_HEADERS }),
)

/** PATCH /api/invoices/[id]: edits a draft entered in Kledg (409 once posted or imported). */
export const PATCH = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['update'] }, body: UpdateInvoiceBodySchema },
  async ({ companyId, params, body }) => NextResponse.json(await updateInvoice(companyId, params.id as string, body)),
)

/** DELETE /api/invoices/[id]: deletes a draft (409 once posted). */
export const DELETE = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['delete'] } },
  async ({ companyId, params }) => {
    await deleteInvoice(companyId, params.id as string)
    return new NextResponse(null, { status: 204 })
  },
)
