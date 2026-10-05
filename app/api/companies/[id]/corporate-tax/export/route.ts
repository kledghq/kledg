import { companyRoute, fromParam } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { userGroupAccess } from '@/lib/management-fees/access'
import { CorporateTaxExportQuerySchema, exportCorporateTax } from '@/lib/corporate-tax/export-corporate-tax.service'
import { CORPORATE_TAX_EXPORT } from '@/lib/corporate-tax/permissions'

/** GET /api/companies/[id]/corporate-tax/export?fiscalYearId=&format=pdf|csv: the worksheet as a file. */
export const GET = companyRoute(
  { company: fromParam(), permission: CORPORATE_TAX_EXPORT, query: CorporateTaxExportQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportCorporateTax(companyId, query, { access: userGroupAccess(user) }))
  },
)
