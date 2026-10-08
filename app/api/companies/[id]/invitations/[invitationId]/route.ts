import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { revokeInvitation } from '@/lib/rbac/company-invitations.service'

/** Revokes an open invitation: its link stops working (members:manage). Audited. */
export const DELETE = companyRoute(
  { company: fromParam('id'), permission: { members: ['manage'] } },
  async ({ companyId, params }) => NextResponse.json(await revokeInvitation({ companyId, invitationId: params.invitationId as string })),
)
