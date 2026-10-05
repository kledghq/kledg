import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { TrainingReportQuerySchema, loadTrainingReport } from '@/lib/training-report/load-training-report.service'
import { SaveTrainingReportBodySchema, saveTrainingReport } from '@/lib/training-report/save-training-report.service'
import { TRAINING_REPORT_READ, TRAINING_REPORT_WRITE } from '@/lib/training-report/permissions'

/**
 * GET /api/companies/[id]/training-report?fiscalYearId=: the bilan pédagogique et financier of a fiscal year (the
 * last closed one by default): frame C from the books and the origins assigned, frame D, the frames entered, checks.
 */
export const GET = companyRoute(
  { company: fromParam(), permission: TRAINING_REPORT_READ, query: TrainingReportQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await loadTrainingReport(companyId, query), { headers: NO_CACHE_HEADERS }),
)

/** PUT /api/companies/[id]/training-report { fiscalYearId, data }: the frames entered by hand, replaced as a whole. */
export const PUT = companyRoute(
  { company: fromParam(), permission: TRAINING_REPORT_WRITE, body: SaveTrainingReportBodySchema },
  async ({ companyId, body, user }) => NextResponse.json(await saveTrainingReport(companyId, body, { userId: user.id })),
)
