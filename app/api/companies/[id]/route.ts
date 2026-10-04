import { NextResponse } from 'next/server'
import { adminRoute, companyRoute, fromParam } from '@/lib/api/route'
import { getCompanyById, updateCompany, UpdateCompanySchema } from '@/lib/companies/manage-company.service'
import { deleteCompany } from '@/lib/companies/archive-company.service'
import { assertActionAllowed } from '@/lib/instance'

/**
 * GET /api/companies/[id]
 *
 * The company (the URL segment is its slug or id) with its addresses, fiscal
 * years and shareholders. Includes `slug`.
 */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await getCompanyById(companyId)),
)

/**
 * PATCH /api/companies/[id]
 *
 * Updates a company's information (all fields optional, see
 * UpdateCompanySchema). Share capital is recomputed from totalShares and
 * shareNominalValue; SIREN and slug must stay unique. The body holds no
 * foreign ids (addresses are managed through establishments).
 */
export const PATCH = companyRoute(
  // The logo travels as a data URL (up to 2 MB, lib/companies/logo.ts).
  { company: fromParam('id'), permission: { settings: ['update'] }, body: UpdateCompanySchema, maxBodyBytes: 3 * 1024 * 1024 },
  async ({ companyId, body }) => NextResponse.json(await updateCompany(companyId, body)),
)

/**
 * DELETE /api/companies/[id]
 *
 * Deletes an empty company and its data (cascade). Instance administrators
 * only; a company with validated entries or a closed fiscal year answers 409
 * (its books are kept 10 years: archive it with POST /api/companies/[id]/archive).
 * Audited.
 */
export const DELETE = adminRoute({ company: fromParam('id') }, async ({ companyId, user }) => {
  await assertActionAllowed('delete-company', user)
  return NextResponse.json(await deleteCompany(companyId, user))
})
