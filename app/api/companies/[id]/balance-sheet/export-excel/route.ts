/**
 * API route for balance sheet Excel export
 */

import { companyRoute, fromParam } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { exportBalanceSheetExcel } from '@/lib/reports/export-reports.service'
import { StatementExportQuerySchema } from '@/lib/reports/report-query'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { reports: ['export'] }, query: StatementExportQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportBalanceSheetExcel(companyId, query))
  },
)
