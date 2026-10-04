import { NextResponse } from 'next/server'
import { adminRoute, fromParam } from '@/lib/api/route'
import { archiveCompany, restoreCompany } from '@/lib/companies/archive-company.service'
import { assertActionAllowed } from '@/lib/instance'

/**
 * POST /api/companies/[id]/archive: archives the company (read-only, hidden
 * from the lists). Instance administrators only. Audited.
 */
export const POST = adminRoute({ company: fromParam('id') }, async ({ companyId, user }) => {
  await assertActionAllowed('delete-company', user)
  return NextResponse.json(await archiveCompany(companyId, user))
})

/**
 * DELETE /api/companies/[id]/archive: restores an archived company.
 * Instance administrators only. Audited.
 */
export const DELETE = adminRoute({ company: fromParam('id') }, async ({ companyId, user }) =>
  NextResponse.json(await restoreCompany(companyId, user)),
)
