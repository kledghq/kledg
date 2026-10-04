import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { getCompanyAddress } from '@/lib/addresses/manage-addresses.service'

/**
 * GET /api/addresses/[id]?companyId=
 * An address owned by the company; 404 for an address of another company.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { settings: ['read'] } },
  async ({ companyId, params }) => NextResponse.json(await getCompanyAddress(companyId, params.id as string)),
)
