import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { createCompanyPerson, CreatePersonSchema, listCompanyPersons } from '@/lib/companies/manage-persons.service'

/** GET /api/companies/[id]/persons: the persons the company may pick as a shareholder. */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await listCompanyPersons(companyId)),
)

/** POST /api/companies/[id]/persons: creates a person of the company (with its address). 201. */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: CreatePersonSchema },
  async ({ companyId, body }) => NextResponse.json(await createCompanyPerson(companyId, body), { status: 201 }),
)
