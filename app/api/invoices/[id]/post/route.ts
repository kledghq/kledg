import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfInvoice } from '@/lib/api/resources'
import { postInvoice, unpostInvoice } from '@/lib/invoices/post-invoice.service'

/**
 * POST /api/invoices/[id]/post: creates the draft entry of the invoice (AC or
 * VE journal) in the fiscal year containing its date; refused when no open
 * fiscal year contains it (lib/invoices/post-invoice.service.ts).
 */
export const POST = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['create'] } },
  async ({ companyId, params }) => NextResponse.json(await postInvoice(companyId, params.id as string), { status: 201 }),
)

/** DELETE /api/invoices/[id]/post: deletes the draft entry, the invoice is a draft again (409 once validated or paid). */
export const DELETE = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['delete'] } },
  async ({ companyId, params }) => NextResponse.json(await unpostInvoice(companyId, params.id as string)),
)
