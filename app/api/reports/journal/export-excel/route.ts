import { companyRoute, fromQuery } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { exportJournalExcel } from '@/lib/reports/export-reports.service'
import { JournalReportQuerySchema } from '@/lib/reports/report-query'

/** GET ?companyId=&journalId=&startDate=&endDate=: the journal report as an Excel workbook. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['export'] }, query: JournalReportQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportJournalExcel(companyId, query))
  },
)
