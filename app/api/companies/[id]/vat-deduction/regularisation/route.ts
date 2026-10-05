import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { VatRegularisationBodySchema, prepareVatRegularisation } from '@/lib/vat-deduction/prepare-regularisation.service'
import { VAT_DEDUCTION_WRITE } from '@/lib/vat-deduction/permissions'

/**
 * POST /api/companies/[id]/vat-deduction/regularisation { year }: the regularisation of the coefficient de déduction
 * of a finished year as a DRAFT entry dated 31 March of the following year (44566 / 758, or 658 / 44566), never
 * validated. Idempotent: a matching draft is kept, a stale one replaced, a validated entry left alone.
 */
export const POST = companyRoute(
  { company: fromParam(), permission: VAT_DEDUCTION_WRITE, body: VatRegularisationBodySchema },
  async ({ companyId, body }) => {
    const result = await prepareVatRegularisation(companyId, body)
    return NextResponse.json(result, { status: result.status === 'created' || result.status === 'replaced' ? 201 : 200 })
  },
)
