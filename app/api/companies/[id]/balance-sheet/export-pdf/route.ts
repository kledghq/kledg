/**
 * API route for balance sheet PDF export
 */

import { companyRoute, fromParam } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { exportBalanceSheetPdf } from '@/lib/reports/export-reports.service'
import { StatementQuerySchema } from '@/lib/reports/report-query'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { reports: ['export'] }, query: StatementQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportBalanceSheetPdf(companyId, query))
  },
)
