import type { SidebarHidden } from "@/lib/navigation/sidebar-preferences"
import { HOME_URLS, navGroups, simpleNavGroups, type NavGroup } from "@/components/layout/nav-config"

/**
 * Personal sidebar menus (docs/modes-et-menu.md): the entries and groups a
 * user hid in one company, applied on top of the navigation of their display
 * mode. Pure: the API route sanitizes with it, the sidebar and its editor
 * render with it.
 *
 * Invariants:
 * - the home entry (Tableau de bord, Accueil) and the group holding it are
 *   never hidden, and "Personnaliser le menu" is not an entry: the user can
 *   always come back;
 * - an id that names nothing (a page removed since, a typo) is dropped on
 *   write and ignored on read, never an error;
 * - hiding only removes the entry from the menu: the page, its URL, the
 *   links to it and its breadcrumb title stay.
 */

/** Every company navigation an id may come from: an entry hidden once stays hidden in every mode that lists it. */
const ALL_GROUPS: readonly NavGroup[] = [...navGroups, ...simpleNavGroups]

const isHomeGroup = (group: NavGroup) => group.items.some((item) => HOME_URLS.has(item.url))

/** URLs of the entries a user may hide (all but the homes). */
export const HIDEABLE_ITEM_URLS: ReadonlySet<string> = new Set(
  ALL_GROUPS.flatMap((group) => group.items.map((item) => item.url)).filter((url) => !HOME_URLS.has(url)),
)

/** Ids of the groups a user may hide (all but the one holding the home). */
export const HIDEABLE_GROUP_IDS: ReadonlySet<string> = new Set(ALL_GROUPS.filter((group) => !isHomeGroup(group)).map((group) => group.id))

const known = (ids: readonly string[], allowed: ReadonlySet<string>) => [...new Set(ids)].filter((id) => allowed.has(id))

/** Known, hideable ids only, each once, in the order given. */
export function sanitizeSidebarHidden(hidden: { hiddenItems: readonly string[]; hiddenGroups: readonly string[] }): SidebarHidden {
  return { hiddenItems: known(hidden.hiddenItems, HIDEABLE_ITEM_URLS), hiddenGroups: known(hidden.hiddenGroups, HIDEABLE_GROUP_IDS) }
}

export const isGroupHideable = (group: NavGroup) => HIDEABLE_GROUP_IDS.has(group.id) && !isHomeGroup(group)
export const isItemHideable = (url: string) => HIDEABLE_ITEM_URLS.has(url)

/** The groups of the menu without what the user hid; groups left empty are left out. */
export function applySidebarHidden(groups: readonly NavGroup[], hidden: SidebarHidden): NavGroup[] {
  const items = new Set(hidden.hiddenItems)
  const hiddenGroups = new Set(hidden.hiddenGroups)
  return groups
    .filter((group) => !(isGroupHideable(group) && hiddenGroups.has(group.id)))
    .map((group) => ({ ...group, items: group.items.filter((item) => !(isItemHideable(item.url) && items.has(item.url))) }))
    .filter((group) => group.items.length > 0)
}

/** Hides or shows one entry. */
export function toggleItem(hidden: SidebarHidden, url: string, hide: boolean): SidebarHidden {
  if (!isItemHideable(url)) return hidden
  const rest = hidden.hiddenItems.filter((id) => id !== url)
  return { ...hidden, hiddenItems: hide ? [...rest, url] : rest }
}

/** Hides or shows one group. */
export function toggleGroup(hidden: SidebarHidden, groupId: string, hide: boolean): SidebarHidden {
  if (!HIDEABLE_GROUP_IDS.has(groupId)) return hidden
  const rest = hidden.hiddenGroups.filter((id) => id !== groupId)
  return { ...hidden, hiddenGroups: hide ? [...rest, groupId] : rest }
}

/** Shows an entry again, and its group when the group was hidden ("Réafficher" of a hidden current page). */
export function revealItem(hidden: SidebarHidden, groups: readonly NavGroup[], url: string): SidebarHidden {
  const group = groups.find((g) => g.items.some((item) => item.url === url))
  const shown = toggleItem(hidden, url, false)
  return group ? toggleGroup(shown, group.id, false) : shown
}
