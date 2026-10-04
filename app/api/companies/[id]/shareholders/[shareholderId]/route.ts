import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import {
  deleteShareholder,
  updateShareholder,
  UpdateShareholderSchema,
} from '@/lib/companies/manage-shareholders.service'

/** PATCH: updates a shareholder of this company (404 for another company's). */
export const PATCH = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: UpdateShareholderSchema },
  async ({ params, companyId, body, user }) =>
    NextResponse.json(await updateShareholder(companyId, params.shareholderId as string, body, user)),
)

/** DELETE: removes a shareholder of this company. */
export const DELETE = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] } },
  async ({ params, companyId }) => {
    await deleteShareholder(companyId, params.shareholderId as string)
    return NextResponse.json({ success: true, message: 'Actionnaire supprimé avec succès' })
  },
)
