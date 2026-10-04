import { NextResponse } from 'next/server'
import { adminRoute, authedRoute } from '@/lib/api/route'
import { CreateCompanySchema } from '@/lib/companies/company-wizard'
import { createCompany } from '@/lib/companies/create-company.service'
import { listCompaniesForUser } from '@/lib/companies/manage-company.service'
import { writeAuditLog } from '@/lib/audit'

/** Companies the user is a member of (all of them for instance administrators), with their slug. */
export const GET = authedRoute({}, async ({ user }) => NextResponse.json(await listCompaniesForUser(user)))

/**
 * Creates a company from the creation wizard (lib/companies/company-wizard.ts
 * validates, lib/companies/create-company.service.ts writes). Instance
 * administrators only.
 */
export const POST = adminRoute({ body: CreateCompanySchema }, async ({ body, user }) => {
  const company = await createCompany(body)
  await writeAuditLog('info', 'Company created', {
    action: 'CREATE_COMPANY',
    companyId: company.id,
    metadata: { userId: user.id, fiscalYearId: company.fiscalYearId },
  })
  return NextResponse.json(company, { status: 201 })
})
