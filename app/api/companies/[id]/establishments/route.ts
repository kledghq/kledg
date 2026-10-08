import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import {
  createEstablishment,
  CreateEstablishmentSchema,
  getCompanyEstablishments,
} from '@/lib/companies/manage-establishments.service'

/**
 * GET /api/companies/[id]/establishments
 * Active establishments of the company, the main one first. A read never
 * writes (KLEDG-R3-AUTHZ-07): a company without any establishment answers an
 * empty list, and the user adds the main one with its SIRET.
 */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await getCompanyEstablishments(companyId)),
)

/**
 * POST /api/companies/[id]/establishments
 * Creates an establishment (SIRET unique, 409 when taken). 201.
 */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: CreateEstablishmentSchema },
  async ({ companyId, body }) => NextResponse.json(await createEstablishment(companyId, body), { status: 201 }),
)
