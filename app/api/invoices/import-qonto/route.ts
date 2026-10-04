import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { ImportQontoBodySchema, importQontoInvoices } from '@/lib/invoices/import-qonto-invoices.service'

/**
 * POST /api/invoices/import-qonto { companyId, since? }
 * Imports Qonto clients, client invoices and supplier invoices (read-only,
 * idempotent by Qonto id). Rate limited like every bank API call.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: ImportQontoBodySchema },
  async ({ companyId, body, authorize }) => {
    authorize({ banking: ['read'] })
    return NextResponse.json(await importQontoInvoices(companyId, { since: body.since }))
  },
)
