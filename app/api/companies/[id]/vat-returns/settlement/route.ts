import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { prepareVatSettlement, VatSettlementBodySchema } from '@/lib/vat-returns/prepare-vat-settlement.service'
import { VAT_RETURN_WRITE } from '@/lib/vat-returns/permissions'

/**
 * POST /api/companies/[id]/vat-returns/settlement { period }: prepares the settlement entry of the
 * return as a DRAFT (never validated). Idempotent: a matching draft is kept, a stale one replaced.
 */
export const POST = companyRoute(
  { company: fromParam(), permission: VAT_RETURN_WRITE, body: VatSettlementBodySchema },
  async ({ companyId, body }) => {
    const result = await prepareVatSettlement(companyId, body.period)
    return NextResponse.json(result, { status: result.status === 'created' || result.status === 'replaced' ? 201 : 200 })
  },
)
