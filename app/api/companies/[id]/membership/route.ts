import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { leaveCompany } from '@/lib/rbac/remove-member.service'

/**
 * The signed-in user leaves the company ("Quitter la société"): any member,
 * unless they are the last member able to manage the members
 * (lib/rbac/member-removal-rules.ts). Rate limited, audited.
 */
export const DELETE = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ companyId, user }) => NextResponse.json({ ok: true, ...(await leaveCompany({ companyId, actor: user })) }),
)
