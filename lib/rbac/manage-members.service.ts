/**
 * Members of a company (Better Auth organization members): list, change the
 * role; and the user search used to add one. Adding a member is
 * lib/rbac/add-member-to-company.service.ts, removing one (or leaving)
 * lib/rbac/remove-member.service.ts. Every lookup is scoped by the
 * company: a member id of another company is a 404.
 *
 * A member holds one company role; the column stores a comma separated list
 * (Better Auth format), so reads split it.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { resolveCompanyRef } from '@/lib/companies/slug'
import { COMPANY_ROLES, type CompanyRoleName } from './add-member-to-company.service'

const MEMBER_NOT_FOUND_MESSAGE = 'Membre introuvable'

function rolesOf(role: string): string[] {
  return role
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
}

/** Members of the company, oldest first, with their user's email and name. */
export async function listMembers(companyId: string) {
  // A read never writes (KLEDG-R3-AUTHZ-07): a company without its
  // organization row yet has no member; adding one creates it.
  const members = await prisma.member.findMany({
    where: { organization: { companyId } },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    roles: rolesOf(m.role),
    createdAt: m.createdAt,
  }))
}

/**
 * Sets the member's company role. Without a role, keeps its current company
 * role (and drops any other value the column held).
 */
export async function updateMemberRole(companyId: string, memberId: string, role: CompanyRoleName | undefined) {
  const member = await prisma.member.findFirst({
    where: { id: memberId, organization: { companyId } },
    select: { id: true, role: true, userId: true },
  })
  if (!member) throw new NotFoundError(MEMBER_NOT_FOUND_MESSAGE)

  const current = rolesOf(member.role).find((r): r is CompanyRoleName => (COMPANY_ROLES as readonly string[]).includes(r))
  const nextRole = role ?? current
  if (!nextRole) throw new ValidationError('Indiquez le rôle du membre.')

  const updated = await prisma.member.update({ where: { id: member.id }, data: { role: nextRole }, select: { id: true } })
  return { id: updated.id, roles: [nextRole], userId: member.userId, previousRole: current ?? null }
}

export interface UserSearch {
  /** Part of the email or name, case insensitive. */
  search?: string
  /** Company (id or slug) whose members are left out, to add a member. */
  excludeCompany?: string
  limit: number
}

/** Users of the instance by email, for instance administrators adding a member. */
export async function searchUsers({ search, excludeCompany, limit }: UserSearch) {
  const excludedCompanyId = excludeCompany ? await resolveCompanyRef(excludeCompany) : null
  return prisma.user.findMany({
    where: {
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(excludedCompanyId ? { members: { none: { organization: { companyId: excludedCompanyId } } } } : {}),
    },
    select: { id: true, email: true, name: true },
    orderBy: { email: 'asc' },
    take: limit,
  })
}
