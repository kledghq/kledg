import { NextResponse } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { CreateCompanySchema } from '@/lib/companies/company-wizard'
import { createCompany } from '@/lib/companies/create-company.service'
import { listCompaniesForUser } from '@/lib/companies/manage-company.service'
import { writeAuditLog } from '@/lib/audit'
import { afterCompanyCreated, assertCompanyCreationAllowed } from '@/lib/instance'

/** Companies the user is a member of (all of them for instance administrators), with their slug. */
export const GET = authedRoute({}, async ({ user }) => NextResponse.json(await listCompaniesForUser(user)))

/**
 * Creates a company from the creation wizard (lib/companies/company-wizard.ts
 * validates, lib/companies/create-company.service.ts writes). Instance
 * administrators, and the users the instance policy lets create companies
 * (companyCreationRefusal, lib/instance/policy.ts): they become the
 * company's administrator.
 */
export const POST = authedRoute({ body: CreateCompanySchema }, async ({ body, user }) => {
  const actor = { id: user.id, email: user.email, role: user.role }
  await assertCompanyCreationAllowed(actor)
  const company = await createCompany(body, actor)
  await writeAuditLog('info', 'Company created', {
    action: 'CREATE_COMPANY',
    companyId: company.id,
    metadata: { userId: user.id, fiscalYearId: company.fiscalYearId },
  })
  await afterCompanyCreated(company.id, actor)
  return NextResponse.json(company, { status: 201 })
})
