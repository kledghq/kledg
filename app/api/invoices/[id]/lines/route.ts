import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfInvoice } from '@/lib/api/resources'
import { UpdateLineAccountsBodySchema, updateInvoiceLineAccounts } from '@/lib/invoices/manage-invoices.service'

/** PATCH /api/invoices/[id]/lines { lines: [{ id, accountCode, nature, fixedAsset }] }: accounts of a draft's lines, amounts unchanged (imported invoices). */
export const PATCH = companyRoute(
  { company: fromResource(companyOfInvoice), permission: { entries: ['update'] }, body: UpdateLineAccountsBodySchema },
  async ({ companyId, params, body }) => NextResponse.json(await updateInvoiceLineAccounts(companyId, params.id as string, body)),
)
