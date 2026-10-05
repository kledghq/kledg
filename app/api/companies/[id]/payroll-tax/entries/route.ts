import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { PayrollTaxEntryBodySchema, preparePayrollTaxEntry } from '@/lib/payroll-tax/prepare-payroll-tax-entry.service'
import { PAYROLL_TAX_WRITE } from '@/lib/payroll-tax/permissions'

/**
 * POST /api/companies/[id]/payroll-tax/entries { year }: the taxe sur les salaires of the year as a DRAFT entry
 * (6311 / 447) dated 31 December, never validated. Idempotent.
 */
export const POST = companyRoute(
  { company: fromParam(), permission: PAYROLL_TAX_WRITE, body: PayrollTaxEntryBodySchema },
  async ({ companyId, body }) => {
    const result = await preparePayrollTaxEntry(companyId, body)
    return NextResponse.json(result, { status: result.status === 'created' || result.status === 'replaced' ? 201 : 200 })
  },
)
