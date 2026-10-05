import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import {
  CorporateTaxFilingBodySchema,
  CorporateTaxFilingQuerySchema,
  deleteCorporateTaxFiling,
  recordCorporateTaxFiling,
} from '@/lib/corporate-tax/record-corporate-tax.service'
import { CORPORATE_TAX_WRITE } from '@/lib/corporate-tax/permissions'

/** PUT /api/companies/[id]/corporate-tax/filing: records that the user filed the return of a fiscal year on impots.gouv.fr. */
export const PUT = companyRoute(
  { company: fromParam(), permission: CORPORATE_TAX_WRITE, body: CorporateTaxFilingBodySchema },
  async ({ companyId, body, user }) => NextResponse.json(await recordCorporateTaxFiling(companyId, body, { userId: user.id })),
)

/** DELETE /api/companies/[id]/corporate-tax/filing?fiscalYearId=: removes that record. */
export const DELETE = companyRoute(
  { company: fromParam(), permission: CORPORATE_TAX_WRITE, query: CorporateTaxFilingQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await deleteCorporateTaxFiling(companyId, query.fiscalYearId)),
)
