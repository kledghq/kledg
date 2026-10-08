/**
 * Who may remove whom from a company (docs/membres-et-invitations.md), as a
 * pure decision: the removal service (lib/rbac/remove-member.service.ts)
 * applies it under a lock, and the Membres page shows its answer next to
 * each member (a disabled "Retirer" says why). No database access: usable
 * on both sides.
 *
 * Rules, for an actor who is not an instance administrator:
 * - removing someone else needs members:manage in the company;
 * - never a member holding a right the actor lacks there (the "never more
 *   than your own rights" rule of the invitations);
 * - never an instance administrator;
 * - never the last member able to manage the members: the company would
 *   have nobody left to manage it. Leaving the company yourself follows
 *   this rule too.
 * An instance administrator removes any member: they hold every right and
 * reach every company, so the company never becomes unmanageable for them.
 */

import { grantedPermissions, grants, type GrantedPermissions } from './granted-permissions'

export const NOT_A_MANAGER_MESSAGE = 'Seuls les administrateurs de la société peuvent retirer un membre.'
export const INSTANCE_ADMIN_TARGET_MESSAGE =
  "Un administrateur de l'instance ne peut être retiré de la société que par un administrateur de l'instance."
export const ABOVE_ACTOR_MESSAGE = 'Vous ne pouvez pas retirer un membre qui a plus de droits que vous dans cette société.'
export const LAST_MANAGER_MESSAGE =
  "C'est le dernier administrateur de la société : sans lui, plus personne ne pourrait en gérer les membres."
export const LAST_MANAGER_SELF_MESSAGE =
  "Vous êtes le dernier administrateur de la société : invitez d'abord un autre administrateur, sinon plus personne ne pourra en gérer les membres."

/** A member as the decision needs it: their company roles, and whether their account administers the instance. */
export interface RemovalSubject {
  userId: string
  roles: readonly string[]
  isInstanceAdmin: boolean
}

export interface RemovalActor {
  userId: string
  isInstanceAdmin: boolean
  /** The actor's rights in the company (every right for an instance administrator). */
  permissions: GrantedPermissions
}

/** Whether `member` can manage the members of the company (members:manage, or an instance administrator). */
export function managesMembers(member: Pick<RemovalSubject, 'roles' | 'isInstanceAdmin'>): boolean {
  return member.isInstanceAdmin || grants(grantedPermissions([...member.roles], false), { members: ['manage'] })
}

/**
 * Why `actor` may not remove `target` from the company, or null when they
 * may. `otherManagers` counts the members other than the target who can
 * manage the members (managesMembers; a banned account counts for nothing).
 */
export function removalRefusal(actor: RemovalActor, target: RemovalSubject, otherManagers: number): string | null {
  if (actor.isInstanceAdmin) return null
  const self = actor.userId === target.userId
  if (!self) {
    if (!grants(actor.permissions, { members: ['manage'] })) return NOT_A_MANAGER_MESSAGE
    if (target.isInstanceAdmin) return INSTANCE_ADMIN_TARGET_MESSAGE
    if (!grants(actor.permissions, grantedPermissions([...target.roles], false))) return ABOVE_ACTOR_MESSAGE
  }
  if (managesMembers(target) && otherManagers === 0) return self ? LAST_MANAGER_SELF_MESSAGE : LAST_MANAGER_MESSAGE
  return null
}
