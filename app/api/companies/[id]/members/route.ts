import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminRoute, companyRoute, fromParam } from '@/lib/api/route'
import { addMemberToCompany, COMPANY_ROLES } from '@/lib/rbac/add-member-to-company.service'
import { listMembers } from '@/lib/rbac/manage-members.service'
import { assertActionAllowed } from '@/lib/instance'
import { writeAuditLog } from '@/lib/audit'

const AddMemberSchema = z.object({
  email: z.email('Email invalide.'),
  name: z.string().max(200).optional(),
  role: z.enum(COMPANY_ROLES, { error: 'Rôle invalide.' }),
})

/** Members of the company with their role (any member may read them). */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await listMembers(companyId)),
)

/** Adds a member, creating the user when needed. Instance administrators only. Audited. */
export const POST = adminRoute({ company: fromParam('id'), body: AddMemberSchema }, async ({ companyId, user, body }) => {
  await assertActionAllowed('invite-member', user)
  const added = await addMemberToCompany({ companyId, ...body })
  await writeAuditLog('info', 'Membre ajouté à la société', {
    action: 'MEMBER_ADDED',
    companyId,
    metadata: { memberId: added.memberId, userId: added.userId, role: body.role, createdUser: added.createdUser },
  })
  return NextResponse.json(added, { status: 201 })
})
