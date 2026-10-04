import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfInvoice } from '@/lib/api/resources'
import { removeInvoicePayment } from '@/lib/invoices/invoice-payments.service'

/** DELETE /api/invoices/[id]/payments/[paymentId]: removes a payment (and its draft VAT move); 409 once the invoice is lettered. */
export const DELETE = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['update'] } },
  async ({ companyId, params }) => {
    await removeInvoicePayment(companyId, params.id as string, params.paymentId as string)
    return new NextResponse(null, { status: 204 })
  },
)
