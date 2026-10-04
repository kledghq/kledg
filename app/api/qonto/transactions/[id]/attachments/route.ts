import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import {
  listQontoTransactionAttachments,
  TransactionAttachmentsQuerySchema,
} from '@/lib/integrations/providers/qonto/read-qonto-attachments.service'

/**
 * GET /api/qonto/transactions/[id]/attachments?companyId=&page=&per_page=
 * Lists the receipts Qonto holds for a transaction of the company, given by
 * its Qonto UUID or its external id.
 * Documentation: https://docs.qonto.com/api-reference/business-api/expense-management/attachments-in-transactions/list-attachments-for-a-transaction
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] }, query: TransactionAttachmentsQuerySchema },
  async ({ params, query, companyId }) =>
    NextResponse.json(await listQontoTransactionAttachments(companyId, (params.id as string) ?? '', query)),
)
