import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfInvoice } from '@/lib/api/resources'
import { recordInvoicePayment, RecordPaymentBodySchema } from '@/lib/invoices/invoice-payments.service'

/**
 * POST /api/invoices/[id]/payments { entryLineId }: records a bank payment
 * (a line of a validated, reconciled entry) on the invoice; the invoice is
 * lettered with its payments once they cover it.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['update'] }, body: RecordPaymentBodySchema },
  async ({ companyId, params, body }) => NextResponse.json(await recordInvoicePayment(companyId, params.id as string, body.entryLineId), { status: 201 }),
)
