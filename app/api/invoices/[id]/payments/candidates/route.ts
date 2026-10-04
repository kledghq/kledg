import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { companyOfInvoice } from '@/lib/api/resources'
import { listPaymentCandidates } from '@/lib/invoices/invoice-payments.service'

/** GET /api/invoices/[id]/payments/candidates: reconciled bank payments that may settle the invoice, exact amounts first. */
export const GET = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['read'] } },
  async ({ companyId, params }) => NextResponse.json(await listPaymentCandidates(companyId, params.id as string), { headers: NO_CACHE_HEADERS }),
)
