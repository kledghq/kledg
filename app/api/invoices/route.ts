import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { CreateInvoiceBodySchema, createInvoice, ListInvoicesQuerySchema, listInvoices } from '@/lib/invoices/manage-invoices.service'

/**
 * GET /api/invoices?companyId=&direction=SALE|PURCHASE&status=&search=&tiersId=&startDate=&endDate=&cursor=&limit=
 * Invoices of the company, newest first, page by page ({ items, nextCursor }).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: ListInvoicesQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await listInvoices(companyId, query), { headers: NO_CACHE_HEADERS }),
)

/** POST /api/invoices { companyId, direction, tiersId, number, issueDate, lines... }: records a draft invoice, totals computed here. */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: CreateInvoiceBodySchema },
  async ({ companyId, body }) => NextResponse.json(await createInvoice(companyId, body), { status: 201 }),
)
