/**
 * Who acts on expense reports. A member with `expenses:submit` (every role)
 * records and submits their own reports; a member with `expenses:validate`
 * (company administrator, accountant) sees and handles everyone's
 * (lib/permissions.ts). The services take this actor and scope every read
 * and write by it: a report of another claimant is "introuvable" for a
 * member who only submits.
 */

import { getUserRolesForCompany, isGlobalAdmin, rolesGrant } from '@/lib/rbac/authorize'
import type { CurrentUser } from '@/lib/session'

export interface ExpenseActor {
  userId: string
  /** Display name, for the claimant created on a first report. */
  userName?: string | null
  /** expenses:validate: every report of the company, validation. */
  canManage: boolean
}

/** The actor of a route, from the wrapper's user and `can` (lib/api/route.ts). */
export function routeActor(ctx: { user: Pick<CurrentUser, 'id' | 'name'>; can: (permission: { expenses: readonly ['validate'] }) => boolean }): ExpenseActor {
  return { userId: ctx.user.id, userName: ctx.user.name, canManage: ctx.can({ expenses: ['validate'] }) }
}

/** The actor of a user in a company, from their roles (MCP tools; routes use the wrapper's `can`). */
export async function expenseActorOf(user: Pick<CurrentUser, 'id' | 'role' | 'name'>, companyId: string): Promise<ExpenseActor> {
  const canManage = isGlobalAdmin(user) || rolesGrant(await getUserRolesForCompany(user.id, companyId), { expenses: ['validate'] })
  return { userId: user.id, userName: user.name, canManage }
}
