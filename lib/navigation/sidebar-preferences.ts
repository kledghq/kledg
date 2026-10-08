/**
 * Personal sidebar menus (docs/modes-et-menu.md): what one user hid from
 * their menu in one company, on top of their display mode. Pure (zod only):
 * the API validates bodies with it, the sidebar and its editor share the
 * types.
 *
 * Ids: an entry is named by its company-relative URL ("/banking/statements"),
 * a group by the stable id of its NavGroup ("saisie"), never by a label.
 * This module checks their shape only; which ids exist is the navigation's
 * business (components/layout/sidebar-menu.ts drops unknown ids on write and
 * on read), so pages come and go without a migration.
 */

import { z } from 'zod'

/** More than the navigation holds, so a menu is never cut; bounds what a request may send. */
const MAX_HIDDEN_ITEMS = 120
const MAX_HIDDEN_GROUPS = 20

const ItemId = z
  .string()
  .max(120)
  .regex(/^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/, { error: 'Entrée de menu inconnue' })
const GroupId = z
  .string()
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/, { error: 'Groupe de menu inconnu' })

/** Body of PUT /api/companies/[id]/sidebar-preferences: the whole set, replaced. */
export const SidebarPreferencesBody = z.strictObject({
  hiddenItems: z.array(ItemId).max(MAX_HIDDEN_ITEMS, { error: `Au plus ${MAX_HIDDEN_ITEMS} entrées masquées` }),
  hiddenGroups: z.array(GroupId).max(MAX_HIDDEN_GROUPS, { error: `Au plus ${MAX_HIDDEN_GROUPS} groupes masqués` }),
})
export type SidebarPreferencesInput = z.infer<typeof SidebarPreferencesBody>

/** What a user hid in one company. Both lists empty: the whole menu of the mode. */
export interface SidebarHidden {
  hiddenItems: string[]
  hiddenGroups: string[]
}

export const NOTHING_HIDDEN: SidebarHidden = Object.freeze({ hiddenItems: [], hiddenGroups: [] }) as SidebarHidden

export const isNothingHidden = (hidden: SidebarHidden) => hidden.hiddenItems.length === 0 && hidden.hiddenGroups.length === 0
