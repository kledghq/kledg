import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { SaveTrainingOriginsBodySchema, saveTrainingOrigins } from '@/lib/training-report/save-training-report.service'
import { TRAINING_REPORT_WRITE } from '@/lib/training-report/permissions'

/** PUT /api/companies/[id]/training-report/origins { accounts?, customers? }: the frame C line of revenue accounts and customers. */
export const PUT = companyRoute(
  { company: fromParam(), permission: TRAINING_REPORT_WRITE, body: SaveTrainingOriginsBodySchema },
  async ({ companyId, body }) => NextResponse.json(await saveTrainingOrigins(companyId, body)),
)
