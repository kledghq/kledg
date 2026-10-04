import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfInvoice } from '@/lib/api/resources'
import { settleInvoice } from '@/lib/invoices/invoice-payments.service'

/** POST /api/invoices/[id]/settle: letters an invoice whose recorded payments cover it (after its entry was validated). */
export const POST = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['update'] } },
  async ({ companyId, params }) => NextResponse.json(await settleInvoice(companyId, params.id as string)),
)
