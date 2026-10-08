import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfProvision } from '@/lib/api/resources'
import { AssessmentBodySchema, AssessmentQuerySchema, deleteAssessment, saveAssessment } from '@/lib/provisions/manage-provisions.service'

const company = fromResource(companyOfProvision)

/**
 * PUT /api/provisions/[id]/assessment { fiscalYearId, amountCents | currentValueCents, basis? }:
 * the balance required at the closing (for a fixed asset, from its current value).
 * A linked draft entry is deleted, to be prepared again; a validated one must be reversed first (409).
 */
export const PUT = companyRoute({ company, permission: { entries: ['create'] }, body: AssessmentBodySchema }, async ({ companyId, params, body }) =>
  NextResponse.json(await saveAssessment(companyId, params.id as string, body)),
)

/** DELETE /api/provisions/[id]/assessment?fiscalYearId=: removes the assessment of the closing and its draft entry. */
export const DELETE = companyRoute({ company, permission: { entries: ['delete'] }, query: AssessmentQuerySchema }, async ({ companyId, params, query }) => {
  await deleteAssessment(companyId, params.id as string, query.fiscalYearId)
  return new NextResponse(null, { status: 204 })
})
