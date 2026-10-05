import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { VatDeductionQuerySchema, loadVatDeduction } from '@/lib/vat-deduction/load-vat-deduction.service'
import { SaveVatDeductionBodySchema, saveVatDeduction } from '@/lib/vat-deduction/save-vat-deduction.service'
import { VAT_DEDUCTION_READ, VAT_DEDUCTION_WRITE } from '@/lib/vat-deduction/permissions'

/**
 * GET /api/companies/[id]/vat-deduction?year=: the coefficient de déduction of a calendar year (CGI ann. II art. 205
 * to 207): revenue by treatment, coefficient de taxation, provisional and definitive coefficients, regularisation.
 */
export const GET = companyRoute(
  { company: fromParam(), permission: VAT_DEDUCTION_READ, query: VatDeductionQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await loadVatDeduction(companyId, query), { headers: NO_CACHE_HEADERS }),
)

/** PUT /api/companies/[id]/vat-deduction { partialVatDeduction?, year?, estimatedTaxationPercent?, assujettissementPercent?, incurredVatCents?, note?, accounts? }. */
export const PUT = companyRoute(
  { company: fromParam(), permission: VAT_DEDUCTION_WRITE, body: SaveVatDeductionBodySchema },
  async ({ companyId, body, user }) => NextResponse.json(await saveVatDeduction(companyId, body, { userId: user.id })),
)
