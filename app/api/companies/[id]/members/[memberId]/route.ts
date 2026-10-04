import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminRoute, fromParam } from '@/lib/api/route'
import { COMPANY_ROLES } from '@/lib/rbac/add-member-to-company.service'
import { removeMember, updateMemberRole } from '@/lib/rbac/manage-members.service'
import { writeAuditLog } from '@/lib/audit'

const UpdateMemberSchema = z.object({
  role: z.enum(COMPANY_ROLES, { error: 'Rôle invalide.' }).optional(),
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

/** Removes a member from the company (the user account stays). Instance administrators only. Audited. */
export const DELETE = adminRoute({ company: fromParam('id') }, async ({ params, companyId }) => {
  const memberId = params.memberId as string
  const removed = await removeMember(companyId, memberId)
  await writeAuditLog('info', 'Membre retiré de la société', {
    action: 'MEMBER_REMOVED',
    companyId,
    metadata: { memberId, userId: removed.userId, role: removed.role },
  })
  return NextResponse.json({ ok: true })
})
