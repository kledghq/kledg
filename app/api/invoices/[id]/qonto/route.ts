import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfInvoice } from '@/lib/api/resources'
import { resumeQontoInvoice } from '@/lib/invoices/create-in-qonto.service'

/** POST /api/invoices/[id]/qonto: resumes the creation in Qonto of an invoice whose answer was lost (looks for it at Qonto before sending it again). */
export const POST = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['create'] } },
  async ({ companyId, params }) => NextResponse.json(await resumeQontoInvoice(companyId, params.id as string)),
)
