import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { CorporateTaxInputsBodySchema, saveCorporateTaxInputs } from '@/lib/corporate-tax/record-corporate-tax.service'
import { CORPORATE_TAX_WRITE } from '@/lib/corporate-tax/permissions'

/**
 * PUT /api/companies/[id]/corporate-tax/inputs { fiscalYearId, capitalPaidUp?, naturalPersons75?,
 * deficitsOpeningCents?, manualLines?, acomptesPaid? }: what the books cannot tell; only the fields sent change.
 */
export const PUT = companyRoute(
  { company: fromParam(), permission: CORPORATE_TAX_WRITE, body: CorporateTaxInputsBodySchema },
  async ({ companyId, body, user }) => NextResponse.json(await saveCorporateTaxInputs(companyId, body, { userId: user.id })),
)
