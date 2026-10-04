import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { companyOfManagementFeeConvention } from '@/lib/api/resources'
import { userGroupAccess } from '@/lib/management-fees/access'
import { GenerateInvoicesBodySchema, generateManagementFeeInvoices, listBillings } from '@/lib/management-fees/bill-management-fees.service'

const company = fromResource(companyOfManagementFeeConvention)

/** GET /api/management-fees/conventions/[id]/invoices: the periods invoiced, with the state of each invoice on both sides. */
export const GET = companyRoute({ company, permission: { reports: ['read'] } }, async ({ companyId, params, user }) =>
  NextResponse.json({ billings: await listBillings(companyId, params.id as string, userGroupAccess(user)) }, { headers: NO_CACHE_HEADERS }),
)

/**
 * POST /api/management-fees/conventions/[id]/invoices { periodStart, periodEnd, issueDate?, purchaseDrafts }:
 * draft sales invoices of the holding and, with purchaseDrafts, draft purchase
 * invoices proposed to each subsidiary (entries:create there too). Nothing is posted.
 */
export const POST = companyRoute({ company, permission: { entries: ['create'] }, body: GenerateInvoicesBodySchema }, async ({ companyId, params, user, body }) =>
  NextResponse.json(await generateManagementFeeInvoices(companyId, params.id as string, body, userGroupAccess(user)), { status: 201 }),
)
