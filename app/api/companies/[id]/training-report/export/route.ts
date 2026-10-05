import { companyRoute, fromParam } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { TrainingReportExportQuerySchema, exportTrainingReport } from '@/lib/training-report/export-training-report.service'
import { TRAINING_REPORT_EXPORT } from '@/lib/training-report/permissions'

/** GET /api/companies/[id]/training-report/export?fiscalYearId=&format=csv: the bilan pédagogique et financier as a file. */
export const GET = companyRoute(
  { company: fromParam(), permission: TRAINING_REPORT_EXPORT, query: TrainingReportExportQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportTrainingReport(companyId, query))
  },
)
