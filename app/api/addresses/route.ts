import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import {
  createCompanyAddress,
  CreateAddressSchema,
  searchCompanyAddresses,
  SearchAddressesQuerySchema,
} from '@/lib/addresses/manage-addresses.service'

/**
 * GET /api/addresses?companyId=&search=&limit=
 * Addresses of the company matching the term (postal code, city or street),
 * for the address picker of the company settings. [] under 2 characters.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { settings: ['read'] }, query: SearchAddressesQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await searchCompanyAddresses(companyId, query)),
)

/**
 * POST /api/addresses  { companyId, street, street2?, postalCode, city, country? }
 * Returns the id of an identical address of the company, or of a new one
 * owned by the company (only it can attach it): 201 { id }.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { settings: ['update'] }, body: CreateAddressSchema },
  async ({ companyId, body }) => NextResponse.json(await createCompanyAddress(companyId, body), { status: 201 }),
)
