import { companyRoute, fromParam } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { LocalTaxesExportQuerySchema, exportLocalTaxes } from '@/lib/local-taxes/export-local-taxes.service'
import { LOCAL_TAXES_EXPORT } from '@/lib/local-taxes/permissions'

/** GET /api/companies/[id]/local-taxes/export?year=&format=pdf|csv: the local taxes of a year as a file. */
export const GET = companyRoute(
  { company: fromParam(), permission: LOCAL_TAXES_EXPORT, query: LocalTaxesExportQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportLocalTaxes(companyId, query))
  },
)
