import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import {
  deactivateEstablishment,
  updateEstablishment,
  UpdateEstablishmentSchema,
} from '@/lib/companies/manage-establishments.service'

/**
 * PATCH /api/companies/[id]/establishments/[establishmentId]
 * Updates an establishment of this company (404 for another company's).
 */
export const PATCH = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: UpdateEstablishmentSchema },
  async ({ params, companyId, body }) =>
    NextResponse.json(await updateEstablishment(companyId, params.establishmentId as string, body)),
)

/**
 * DELETE /api/companies/[id]/establishments/[establishmentId]
 * Deactivates an establishment of this company (soft delete).
 */
export const DELETE = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] } },
  async ({ params, companyId }) => {
    await deactivateEstablishment(companyId, params.establishmentId as string)
    return NextResponse.json({ success: true })
  },
)
