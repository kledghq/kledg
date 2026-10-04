import { Bot, Building2, CircleArrowUp, Gauge, KeyRound, Palette, ShieldCheck, UserPlus, UserRound, Users, type LucideIcon } from "lucide-react"
import type { UserMenuItemId } from "@/components/layout/user-menu"

export interface SettingsNavItem {
  title: string
  url: string
  icon: LucideIcon
  /** The user menu entry of the same page: hidden with it (filterUserMenu). */
  menuItem?: UserMenuItemId
}

export interface SettingsNavGroup {
  /** Group heading. Omitted for the top group (companies). */
  label?: string
  /** Shown to instance administrators only. */
  adminOnly?: boolean
  items: SettingsNavItem[]
}

// Pages outside a company: the user's companies, the account, and the
// instance (administrators). URLs are absolute.
export const settingsNavGroups: SettingsNavGroup[] = [
  {
    items: [{ title: "Mes sociétés", url: "/companies", icon: Building2 }],
  },
  {
    label: "Compte",
    items: [
      { title: "Profil", url: "/settings/profile", icon: UserRound, menuItem: "profile" },
      { title: "Apparence", url: "/settings/appearance", icon: Palette, menuItem: "appearance" },
      { title: "Assistants IA", url: "/settings/assistants", icon: Bot, menuItem: "assistants" },
      { title: "Clés API", url: "/settings/api-keys", icon: KeyRound, menuItem: "api-keys" },
      { title: "Actions IA à approuver", url: "/settings/ai-actions", icon: ShieldCheck, menuItem: "ai-actions" },
    ],
  },
  {
    label: "Instance",
    adminOnly: true,
    items: [
      { title: "État de l'instance", url: "/welcome", icon: Gauge, menuItem: "instance" },
      { title: "Utilisateurs", url: "/settings/users", icon: Users, menuItem: "users" },
      { title: "Créer un compte", url: "/settings/users/new", icon: UserPlus, menuItem: "create-user" },
      { title: "Mises à jour", url: "/settings/updates", icon: CircleArrowUp, menuItem: "updates" },
    ],
  },
]

/**
 * Instance pages an instance serves itself to a user who is not an instance
 * administrator (instanceSettingsLinks, components/instance/slots.tsx), by
 * user menu entry: absolute URLs of the instance's own pages.
 */
export type InstanceSettingsLinks = Partial<Record<UserMenuItemId, string>>

/**
 * The administrators' group as an instance serves it to a non administrator:
 * only the entries it links, to its own pages.
 */
function withInstanceLinks(group: SettingsNavGroup, links: InstanceSettingsLinks): SettingsNavGroup {
  return {
    ...group,
    items: group.items.flatMap((item) => {
      const url = item.menuItem ? links[item.menuItem] : undefined
      return url ? [{ ...item, url }] : []
    }),
  }
}

/** The groups of this user: for a non administrator, the instance's own links in place of the administrators' group. */
function groupsFor(isAdmin: boolean, instanceLinks?: InstanceSettingsLinks | null): Array<SettingsNavGroup & { linked?: boolean }> {
  return settingsNavGroups.flatMap((group) => {
    if (!group.adminOnly || isAdmin) return [group]
    return instanceLinks ? [{ ...withInstanceLinks(group, instanceLinks), linked: true }] : []
  })
}

/**
 * Groups visible to this user, without the entries whose user menu entry the
 * instance hides (`visibleMenu`, from filterUserMenu); empty groups go too.
 * `instanceLinks` gives a non administrator the instance's own versions of
 * the administrators' pages (kept whatever `visibleMenu` says).
 */
export function visibleSettingsGroups(
  isAdmin: boolean,
  visibleMenu?: readonly UserMenuItemId[],
  instanceLinks?: InstanceSettingsLinks | null,
): SettingsNavGroup[] {
  return groupsFor(isAdmin, instanceLinks)
    .map(({ linked, ...group }) => ({
      ...group,
      items: linked ? group.items : group.items.filter((item) => !item.menuItem || !visibleMenu || visibleMenu.includes(item.menuItem)),
    }))
    .filter((group) => group.items.length > 0)
}

/** The settings entry matching an absolute path (longest prefix wins). */
export function findSettingsEntry(pathname: string, instanceLinks?: InstanceSettingsLinks | null) {
  let best: { group: string; title: string; url: string } | null = null
  for (const group of [...settingsNavGroups, ...(instanceLinks ? groupsFor(false, instanceLinks).filter((g) => g.linked) : [])]) {
    for (const item of group.items) {
      const match = pathname === item.url || pathname.startsWith(item.url + "/")
      if (match && (!best || item.url.length > best.url.length)) {
        best = { group: group.label ?? "", title: item.title, url: item.url }
      }
    }
  }
  return best
}
