/**
 * Account and instance pages reachable from the user menu (sidebar footer)
 * and the settings sidebar, as data, so an instance can filter them
 * (filterUserMenu, components/instance/slots.tsx) on the server before the
 * client menus render them. Pure: icons are chosen by the menus.
 *
 * The user menu itself stays short (identity, account settings, docs, sign
 * out): `inMenu` marks the one entry it shows. Every entry also appears in
 * the settings sidebar (settings-nav-config.ts), which is where account and
 * instance settings are navigated.
 */

import type { InstanceAction } from '@/lib/instance/types'

export type UserMenuItemId = 'profile' | 'appearance' | 'assistants' | 'api-keys' | 'ai-actions' | 'instance' | 'users' | 'updates' | 'create-user'

export interface UserMenuItem {
  id: UserMenuItemId
  label: string
  /** Absolute path. */
  href: string
  scope: 'account'
  /** Shown to instance administrators only. */
  adminOnly: boolean
  /** The restrictable action the entry leads to (lib/instance), if any. */
  action: InstanceAction | null
  /** Shown in the user menu dropdown (the others only in the settings sidebar). */
  inMenu: boolean
}

export const USER_MENU_ITEMS: readonly UserMenuItem[] = [
  // The profile page shows each refused action disabled with the policy's
  // message, so the page itself is never hidden.
  { id: 'profile', label: 'Paramètres', href: '/settings/profile', scope: 'account', adminOnly: false, action: null, inMenu: true },
  // Chart colours: a fork that refuses change-appearance can hide the page (filterUserMenu).
  { id: 'appearance', label: 'Apparence', href: '/settings/appearance', scope: 'account', adminOnly: false, action: 'change-appearance', inMenu: false },
  { id: 'assistants', label: 'Assistants IA', href: '/settings/assistants', scope: 'account', adminOnly: false, action: null, inMenu: false },
  { id: 'api-keys', label: 'Clés API', href: '/settings/api-keys', scope: 'account', adminOnly: false, action: null, inMenu: false },
  { id: 'ai-actions', label: 'Actions IA à approuver', href: '/settings/ai-actions', scope: 'account', adminOnly: false, action: null, inMenu: false },
  { id: 'instance', label: "État de l'instance", href: '/welcome', scope: 'account', adminOnly: true, action: 'onboarding', inMenu: false },
  { id: 'users', label: 'Utilisateurs', href: '/settings/users', scope: 'account', adminOnly: true, action: 'manage-users', inMenu: false },
  { id: 'create-user', label: 'Créer un compte', href: '/settings/users/new', scope: 'account', adminOnly: true, action: 'manage-users', inMenu: false },
  { id: 'updates', label: 'Mises à jour', href: '/settings/updates', scope: 'account', adminOnly: true, action: 'manage-updates', inMenu: false },
]

export const USER_MENU_ITEM_IDS: readonly UserMenuItemId[] = USER_MENU_ITEMS.map((item) => item.id)
