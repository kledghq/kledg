import { companyRoute, fromQuery } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { FixedAssetExportQuerySchema, exportFixedAssetMovements } from '@/lib/annexe/export-fixed-asset-movements.service'

/** GET /api/reports/fixed-asset-movements/export?companyId=&fiscalYearId=&format=pdf|csv: the forms as a file. */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['export'] }, query: FixedAssetExportQuerySchema }, async ({ companyId, user, query }) => {
  await enforceRateLimit('export', user.id)
  return downloadResponse(await exportFixedAssetMovements(companyId, query))
})
