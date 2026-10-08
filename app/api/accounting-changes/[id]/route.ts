import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfAccountingChange } from '@/lib/api/resources'
import { ChangeBodySchema, deleteAccountingChange, updateAccountingChange } from '@/lib/annexe/methods/manage-accounting-methods.service'

const company = fromResource(companyOfAccountingChange)

/** PATCH /api/accounting-changes/[id]: replaces the change; a draft entry that no longer matches is deleted, a validated one refuses (409). */
export const PATCH = companyRoute({ company, permission: { entries: ['update'] }, body: ChangeBodySchema }, async ({ companyId, params, body }) =>
  NextResponse.json(await updateAccountingChange(companyId, params.id as string, body)),
)

/** DELETE /api/accounting-changes/[id]: with its draft entry (409 once the entry is validated). */
export const DELETE = companyRoute({ company, permission: { entries: ['delete'] } }, async ({ companyId, params }) => {
  await deleteAccountingChange(companyId, params.id as string)
  return new NextResponse(null, { status: 204 })
})
