import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getPaymentTerms, PaymentTermsBodySchema, updatePaymentTerms } from '@/lib/companies/payment-terms.service'

/** GET /api/companies/[id]/payment-terms: the payment terms the aged balance uses. */
export const GET = companyRoute(
  { company: fromParam(), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await getPaymentTerms(companyId), { headers: NO_CACHE_HEADERS }),
)

/** PUT /api/companies/[id]/payment-terms { days, endOfMonth }: capped by Code de commerce art. L441-10. */
export const PUT = companyRoute(
  { company: fromParam(), permission: { settings: ['update'] }, body: PaymentTermsBodySchema },
  async ({ companyId, body }) => NextResponse.json(await updatePaymentTerms(companyId, body)),
)
