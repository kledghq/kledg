import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import {
  createEstablishment,
  CreateEstablishmentSchema,
  listOrInitializeEstablishments,
} from '@/lib/companies/manage-establishments.service'

/**
 * GET /api/companies/[id]/establishments
 * Active establishments of the company, the main one first (created from the
 * company when it has none yet).
 */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await listOrInitializeEstablishments(companyId)),
)

/**
 * POST /api/companies/[id]/establishments
 * Creates an establishment (SIRET unique, 409 when taken). 201.
 */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: CreateEstablishmentSchema },
  async ({ companyId, body }) => NextResponse.json(await createEstablishment(companyId, body), { status: 201 }),
)
