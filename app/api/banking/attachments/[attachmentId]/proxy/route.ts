import { NextResponse } from 'next/server'
import { companyRoute } from '@/lib/api/route'
import { fromQontoAttachment } from '@/lib/api/bank-resolvers'
import { fileResponseHeaders } from '@/lib/api/files'
import { readQontoReceipt, ReceiptQuerySchema } from '@/lib/integrations/providers/qonto/read-qonto-attachments.service'

/**
 * GET /api/banking/attachments/[attachmentId]/proxy?companyId=&transactionUuid=
 * Serves a Qonto receipt (PDF or image) with safe headers. The attachment
 * must belong to the company; the transaction and the file URL are taken
 * from the stored attachment or a fresh Qonto response, never from the query
 * string (lib/integrations/providers/qonto/read-qonto-attachments.service.ts).
 */
export const GET = companyRoute(
  { company: fromQontoAttachment, permission: { banking: ['read'] }, query: ReceiptQuerySchema },
  async ({ params, query, companyId }) => {
    const receipt = await readQontoReceipt(companyId, params.attachmentId as string, query.transactionUuid)
    // nosniff, safe Content-Disposition; only PDFs and images are shown inline
    return new NextResponse(receipt.body, { headers: fileResponseHeaders(receipt.contentType, receipt.fileName) })
  },
)
