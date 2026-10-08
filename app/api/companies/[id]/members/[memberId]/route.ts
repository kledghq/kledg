import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminRoute, companyRoute, fromParam } from '@/lib/api/route'
import { COMPANY_ROLES } from '@/lib/rbac/add-member-to-company.service'
import { updateMemberRole } from '@/lib/rbac/manage-members.service'
import { removeCompanyMember } from '@/lib/rbac/remove-member.service'
import { writeAuditLog } from '@/lib/audit'

const UpdateMemberSchema = z.object({
  role: z.enum(COMPANY_ROLES, { error: 'Rôle invalide.' }).optional(),
})

const RemoveMemberQuery = z.object({
  /** notify=false: no email notice to the person removed. */
  notify: z.enum(['true', 'false']).optional(),
})

/** Changes a member's role. Instance administrators only. Audited. */
export const PATCH = adminRoute({ company: fromParam('id'), body: UpdateMemberSchema }, async ({ params, companyId, body }) => {
  const memberId = params.memberId as string
  const updated = await updateMemberRole(companyId, memberId, body.role)
  await writeAuditLog('info', "Rôle d'un membre modifié", {
    action: 'MEMBER_ROLE_CHANGED',
    companyId,
    metadata: { memberId, userId: updated.userId, from: updated.previousRole, to: updated.roles[0] },
  })
  return NextResponse.json({ id: updated.id, roles: updated.roles })
})

/**
 * Removes a member from the company (the user account and what they
 * recorded stay): members:manage, never a member with more rights than the
 * user's own, never an instance administrator, never the last member able
 * to manage the members (lib/rbac/member-removal-rules.ts). Ends their
 * access at once, rate limited, audited (lib/rbac/remove-member.service.ts).
 */
export const DELETE = companyRoute(
  { company: fromParam('id'), permission: { members: ['manage'] }, query: RemoveMemberQuery },
  async ({ params, companyId, user, query }) => {
    const removed = await removeCompanyMember({ companyId, memberId: params.memberId as string, actor: user, notify: query.notify !== 'false' })
    return NextResponse.json({ ok: true, ...removed })
  },
)
