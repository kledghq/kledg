import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { resendInvitation } from '@/lib/rbac/company-invitations.service'

/**
 * Sends an open invitation again with a new link, valid 7 days; the previous
 * link stops working (members:manage). Rate limited, audited.
 */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { members: ['manage'] } },
  async ({ companyId, params, user, can }) =>
    NextResponse.json(await resendInvitation({ companyId, invitationId: params.invitationId as string, inviter: user, inviterCan: can })),
)
