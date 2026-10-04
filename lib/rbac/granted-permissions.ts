/**
 * What a user may do in a company, as plain data the client can read: the
 * actions each of the user's roles grants (lib/permissions.ts), computed on
 * the server by the company layout and given to pages through
 * CompanyAccessProvider, so a button the role cannot use is disabled with a
 * reason instead of failing with a 403 on click.
 *
 * The API stays the authority (lib/api/route.ts checks every request); this
 * only mirrors it for display. No database access: usable on both sides.
 */

import { roles, statement, ROLE_LABELS } from '@/lib/permissions'

type Resource = Exclude<keyof typeof statement, 'organization' | 'member' | 'invitation' | 'team' | 'ac'>

/** Kledg's own resources, in the order of lib/permissions.ts. */
const RESOURCES = ['entries', 'ledger', 'closing', 'banking', 'reports', 'settings', 'members', 'expenses', 'budgets'] as const satisfies readonly Resource[]

/** A set of actions per resource, e.g. `{ banking: ['manage'] }`. */
export type PermissionRequest = Partial<Record<(typeof RESOURCES)[number], readonly string[]>>

/** Granted actions per resource, e.g. `{ banking: ['read', 'reconcile'] }`. */
export type GrantedPermissions = Partial<Record<(typeof RESOURCES)[number], string[]>>

type AuthorizeFn = (req: unknown) => { success: boolean }

/** Every action of every Kledg resource: what an instance administrator may do. */
export function allPermissions(): GrantedPermissions {
  return Object.fromEntries(RESOURCES.map((resource) => [resource, [...statement[resource]]])) as GrantedPermissions
}

/** The actions `roleNames` grant together (instance administrators get everything). */
export function grantedPermissions(roleNames: string[], isInstanceAdmin: boolean): GrantedPermissions {
  if (isInstanceAdmin) return allPermissions()
  const granted: GrantedPermissions = {}
  for (const resource of RESOURCES) {
    const actions = (statement[resource] as readonly string[]).filter((action) =>
      roleNames.some((name) => {
        const role = roles[name as keyof typeof roles] as { authorize: AuthorizeFn } | undefined
        return role ? role.authorize({ [resource]: [action] }).success : false
      }),
    )
    if (actions.length > 0) granted[resource] = actions
  }
  return granted
}

/** Whether `granted` includes every action of `request`. */
export function grants(granted: GrantedPermissions, request: PermissionRequest): boolean {
  return Object.entries(request).every(([resource, actions]) =>
    (actions ?? []).every((action) => granted[resource as keyof GrantedPermissions]?.includes(action) ?? false),
  )
}

/** "Comptable", "Administrateur, Comptable", or "Administrateur de l'instance". */
export function roleLabelOf(roleNames: string[], isInstanceAdmin: boolean): string {
  if (isInstanceAdmin) return "Administrateur de l'instance"
  return roleNames.map((name) => ROLE_LABELS[name] ?? name).join(', ') || 'Aucun rôle'
}
