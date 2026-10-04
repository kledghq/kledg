import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getVatSettings, updateVatSettings, VatSettingsBodySchema } from '@/lib/companies/vat-settings.service'

/** GET /api/companies/[id]/vat-settings: VAT on debits option and VAT franchise, as invoices post them. */
export const GET = companyRoute(
  { company: fromParam(), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await getVatSettings(companyId), { headers: NO_CACHE_HEADERS }),
)

/** PUT /api/companies/[id]/vat-settings { servicesVatOnDebits }: option for VAT on debits (CGI art. 269, 2, c). */
export const PUT = companyRoute(
  { company: fromParam(), permission: { settings: ['update'] }, body: VatSettingsBodySchema },
  async ({ companyId, body }) => NextResponse.json(await updateVatSettings(companyId, body)),
)
