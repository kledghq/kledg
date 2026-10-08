import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromParam } from '@/lib/api/route'
import { COMPANY_ROLES } from '@/lib/rbac/add-member-to-company.service'
import { inviteMember, listInvitations } from '@/lib/rbac/company-invitations.service'

const InviteSchema = z.object({
  email: z.string().trim().max(320, 'Email invalide.').pipe(z.email('Email invalide.')),
  role: z.enum(COMPANY_ROLES, { error: 'Rôle invalide.' }),
})

/** Open invitations of the company (members:manage). Never their links. */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { members: ['manage'] } },
  async ({ companyId }) => NextResponse.json({ invitations: await listInvitations(companyId) }),
)

/**
 * Invites a person by email with a company role no higher than the
 * inviter's own (members:manage; the instance policy may refuse
 * 'invite-member'). Rate limited, audited (lib/rbac/company-invitations.service.ts).
 */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { members: ['manage'] }, body: InviteSchema },
  async ({ companyId, user, can, body }) =>
    NextResponse.json(await inviteMember({ companyId, email: body.email, role: body.role, inviter: user, inviterCan: can }), { status: 201 }),
)
