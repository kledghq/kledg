import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { userGroupAccess } from '@/lib/management-fees/access'
import { CorporateTaxEntryBodySchema, prepareCorporateTaxEntry } from '@/lib/corporate-tax/prepare-corporate-tax-entries.service'
import { CORPORATE_TAX_WRITE } from '@/lib/corporate-tax/permissions'

/**
 * POST /api/companies/[id]/corporate-tax/entries { fiscalYearId, kind: 'charge' } or { fiscalYearId, kind:
 * 'acompte', number }: prepares the IS charge (695 / 444) or an acompte payment (444 / 512) as a DRAFT, never
 * validated. Idempotent: a matching draft is kept, a stale one replaced, a validated entry left alone.
 */
export const POST = companyRoute(
  { company: fromParam(), permission: CORPORATE_TAX_WRITE, body: CorporateTaxEntryBodySchema },
  async ({ companyId, body, user }) => {
    const result = await prepareCorporateTaxEntry(companyId, body, { access: userGroupAccess(user) })
    return NextResponse.json(result, { status: result.status === 'created' || result.status === 'replaced' ? 201 : 200 })
  },
)
