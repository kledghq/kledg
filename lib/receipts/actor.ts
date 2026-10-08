/**
 * Who acts on staged receipts (stage-receipt.service.ts): every member
 * stages and files their own receipts; a member who reconciles the bank
 * (banking:reconcile) or validates expense reports (expenses:validate) also
 * reaches the receipts other members staged.
 */

import { getUserRolesForCompany, isGlobalAdmin, rolesGrant, type Permission } from '@/lib/rbac/authorize'
import type { CurrentUser } from '@/lib/session'
import type { StagedReceiptActor } from './stage-receipt.service'

type Can = (permission: Permission) => boolean

/** The actor of a route, from the wrapper's user and `can` (lib/api/route.ts). */
export function routeReceiptActor(ctx: { user: Pick<CurrentUser, 'id'>; can: Can }): StagedReceiptActor {
  return { userId: ctx.user.id, seesAll: ctx.can({ banking: ['reconcile'] }) || ctx.can({ expenses: ['validate'] }) }
}

/** The actor of a user in a company, from their roles (MCP tools). */
export async function receiptActorOf(user: Pick<CurrentUser, 'id' | 'role'>, companyId: string): Promise<StagedReceiptActor> {
  if (isGlobalAdmin(user)) return { userId: user.id, seesAll: true }
  const roles = await getUserRolesForCompany(user.id, companyId)
  return { userId: user.id, seesAll: rolesGrant(roles, { banking: ['reconcile'] }) || rolesGrant(roles, { expenses: ['validate'] }) }
}
