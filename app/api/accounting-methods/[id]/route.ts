import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfAccountingMethod } from '@/lib/api/resources'
import { MethodBodySchema, deleteAccountingMethod, updateAccountingMethod } from '@/lib/annexe/methods/manage-accounting-methods.service'

const company = fromResource(companyOfAccountingMethod)

/** PATCH /api/accounting-methods/[id]: replaces the method (a reference method stays one, PCG art. 121-5). */
export const PATCH = companyRoute({ company, permission: { entries: ['update'] }, body: MethodBodySchema }, async ({ companyId, params, body }) =>
  NextResponse.json(await updateAccountingMethod(companyId, params.id as string, body)),
)

/** DELETE /api/accounting-methods/[id]: the changes linked to it stay, without the link. */
export const DELETE = companyRoute({ company, permission: { entries: ['delete'] } }, async ({ companyId, params }) => {
  await deleteAccountingMethod(companyId, params.id as string)
  return new NextResponse(null, { status: 204 })
})
