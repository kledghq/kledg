import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { CreateInvoiceBodySchema, ListInvoicesQuerySchema, listInvoices } from '@/lib/invoices/manage-invoices.service'
import { issueInvoice } from '@/lib/invoices/create-in-qonto.service'

/**
 * GET /api/invoices?companyId=&direction=SALE|PURCHASE&status=&search=&tiersId=&startDate=&endDate=&cursor=&limit=
 * Invoices of the company, newest first, page by page ({ items, nextCursor }).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: ListInvoicesQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await listInvoices(companyId, query), { headers: NO_CACHE_HEADERS }),
)

/**
 * POST /api/invoices { companyId, direction, tiersId, number?, numbering?, issueDate, lines... }:
 * records a draft invoice, totals computed here. A sales invoice is created
 * in Qonto first (numbering qonto, the default when Qonto-first is on),
 * numbered by Kledg when posted (kledg, automatic numbering), or recorded
 * with its own number (recorded, or kledg when numbers are typed).
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: CreateInvoiceBodySchema },
  async ({ companyId, body }) => NextResponse.json(await issueInvoice(companyId, body), { status: 201 }),
)
