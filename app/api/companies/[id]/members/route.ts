import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminRoute, companyRoute, fromParam } from '@/lib/api/route'
import { addMemberToCompany, COMPANY_ROLES } from '@/lib/rbac/add-member-to-company.service'
import { listMembersWithRemoval } from '@/lib/rbac/remove-member.service'
import { assertActionAllowed } from '@/lib/instance'
import { writeAuditLog } from '@/lib/audit'

const AddMemberSchema = z.object({
  email: z.email('Email invalide.'),
  name: z.string().max(200).optional(),
  role: z.enum(COMPANY_ROLES, { error: 'Rôle invalide.' }),
})

/**
 * Members of the company with their role (any member may read them), and
 * whether the signed-in user may remove each one, or why not.
 */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ companyId, user }) => NextResponse.json(await listMembersWithRemoval(companyId, user)),
)

/** Adds a member, creating the user when needed. Instance administrators only. Audited. */
export const POST = adminRoute({ company: fromParam('id'), body: AddMemberSchema }, async ({ companyId, user, body }) => {
  await assertActionAllowed('invite-member', user)
  const added = await addMemberToCompany({ companyId, ...body })
  await writeAuditLog('info', 'Membre ajouté à la société', {
    action: 'MEMBER_ADDED',
    companyId,
    metadata: { memberId: added.memberId, userId: added.userId, role: body.role, createdUser: added.createdUser, resetUnconfirmedUser: added.resetUnconfirmedUser },
  })
  return NextResponse.json(added, { status: 201 })
})
