import { companyRoute, fromQuery } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { AgedBalanceQuerySchema } from '@/lib/reports/third-parties/get-third-party-reports.service'
import { exportAgedBalanceExcel } from '@/lib/reports/third-parties/export-third-party-reports.service'

/** GET ?companyId=&fiscalYearId=&asOf=: the aged balance as an Excel workbook. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['export'] }, query: AgedBalanceQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportAgedBalanceExcel(companyId, query))
  },
)
