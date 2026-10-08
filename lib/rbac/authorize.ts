import { prisma } from '@/lib/prisma'
import type { CurrentUser } from '@/lib/session'
import { roles, statement, ROLE_LABELS } from '@/lib/permissions'
import { ForbiddenError, NotFoundError } from '@/lib/accounting/errors'

type StatementKey = keyof typeof statement

/** A set of actions per resource, e.g. `{ entries: ['create'] }`. */
export type Permission = Partial<{ [K in StatementKey]: ReadonlyArray<(typeof statement)[K][number]> }>

export { ForbiddenError }

/** Shown when a user is not a member of a company: same answer as a company that doesn't exist. */
export const COMPANY_NOT_FOUND_MESSAGE = 'Société introuvable'

export function isGlobalAdmin(user: Pick<CurrentUser, 'role'>): boolean {
  return user.role === 'admin'
}

export async function getUserRolesForCompany(userId: string, companyId: string): Promise<string[]> {
  const memberships = await prisma.member.findMany({
    where: { userId, organization: { companyId } },
    select: { role: true },
  })
  return memberships.flatMap((m) =>
    m.role
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
  )
}

type AuthorizeFn = (req: unknown) => { success: boolean; error?: string }

/** Whether one of `roleNames` grants `permission` (pure, no database access). */
export function rolesGrant(roleNames: string[], permission: Permission): boolean {
  return roleNames.some((roleName) => {
    const role = roles[roleName as keyof typeof roles] as { authorize: AuthorizeFn } | undefined
    return role ? role.authorize(permission).success : false
  })
}

/**
 * Any role in the company. Non-members get a 404, so the existence of other
 * companies (and of their resources) is never confirmed.
 */
export async function requireCompanyAccess(user: CurrentUser, companyId: string): Promise<string[]> {
  if (isGlobalAdmin(user)) return ['admin']
  const userRoles = await getUserRolesForCompany(user.id, companyId)
  if (userRoles.length === 0) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
  return userRoles
}

/**
 * The user's role in the company must grant `permission`.
 * Non-member: 404. Member without the permission: 403 with a French message.
 */
export async function requireCompanyPermission(
  user: CurrentUser,
  companyId: string,
  permission: Permission,
): Promise<void> {
  const userRoles = await requireCompanyAccess(user, companyId)
  if (userRoles.includes('admin') && isGlobalAdmin(user)) return
  if (!rolesGrant(userRoles, permission)) {
    const label = userRoles.map((r) => ROLE_LABELS[r] ?? r).join(', ')
    throw new ForbiddenError(`Action non autorisée : votre rôle (${label}) ne permet pas cette opération.`)
  }
}
