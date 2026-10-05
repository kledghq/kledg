import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { PayrollTaxQuerySchema, loadPayrollTax } from '@/lib/payroll-tax/load-payroll-tax.service'
import { SavePayrollTaxBodySchema, savePayrollTax } from '@/lib/payroll-tax/save-payroll-tax.service'
import { PAYROLL_TAX_READ, PAYROLL_TAX_WRITE } from '@/lib/payroll-tax/permissions'

/**
 * GET /api/companies/[id]/payroll-tax?year=: the taxe sur les salaires of a calendar year (CGI art. 231): liability and
 * rapport from the revenue of the year before, computation of the 2502, frequency and deadlines, draft.
 */
export const GET = companyRoute(
  { company: fromParam(), permission: PAYROLL_TAX_READ, query: PayrollTaxQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await loadPayrollTax(companyId, query), { headers: NO_CACHE_HEADERS }),
)

/** PUT /api/companies/[id]/payroll-tax { year, data }: the annual base of each employee and the year's settings, replaced as a whole. */
export const PUT = companyRoute(
  { company: fromParam(), permission: PAYROLL_TAX_WRITE, body: SavePayrollTaxBodySchema },
  async ({ companyId, body, user }) => NextResponse.json(await savePayrollTax(companyId, body, { userId: user.id })),
)
