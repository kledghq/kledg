import { companyRoute, fromQuery } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import {
  exportFinancialIndicators,
  FinancialIndicatorsExportQuerySchema,
} from '@/lib/reports/financial-indicators/export-financial-indicators.service'

/** GET ?companyId=&fiscalYearId=&format=csv|xlsx: the SIG and ratios, N and N-1, as a CSV file or an Excel workbook. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['export'] }, query: FinancialIndicatorsExportQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportFinancialIndicators(companyId, query))
  },
)
