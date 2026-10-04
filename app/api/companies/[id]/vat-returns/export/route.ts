import { companyRoute, fromParam } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { exportVatReturn, VatReturnExportQuerySchema } from '@/lib/vat-returns/export-vat-return.service'
import { VAT_RETURN_EXPORT } from '@/lib/vat-returns/permissions'

/** GET /api/companies/[id]/vat-returns/export?period=&format=pdf|csv: the VAT return worksheet as a file. */
export const GET = companyRoute(
  { company: fromParam(), permission: VAT_RETURN_EXPORT, query: VatReturnExportQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportVatReturn(companyId, query))
  },
)
