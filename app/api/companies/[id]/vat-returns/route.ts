import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { loadVatReturn, VatReturnQuerySchema } from '@/lib/vat-returns/load-vat-return.service'
import { VAT_RETURN_READ } from '@/lib/vat-returns/permissions'

/** GET /api/companies/[id]/vat-returns?period=2026-09: the VAT return worksheet of a period (the one due next by default). Kledg prepares, the user files. */
export const GET = companyRoute(
  { company: fromParam(), permission: VAT_RETURN_READ, query: VatReturnQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await loadVatReturn(companyId, query), { headers: NO_CACHE_HEADERS }),
)
