import { companyRoute, fromQuery } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { AuxiliaryBalanceQuerySchema } from '@/lib/reports/third-parties/get-third-party-reports.service'
import { exportAuxiliaryBalanceExcel } from '@/lib/reports/third-parties/export-third-party-reports.service'

/** GET ?companyId=&fiscalYearId=&startDate=&endDate=: the auxiliary balance as an Excel workbook. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['export'] }, query: AuxiliaryBalanceQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportAuxiliaryBalanceExcel(companyId, query))
  },
)
