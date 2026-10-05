import { ArrowLeftRight, BookOpen, Building2, Gauge, Home, Landmark, Network, Wallet } from "lucide-react"
import type { NavGroup } from "@/components/layout/nav-config"
import type { DisplayMode } from "@/lib/appearance/display-mode"

/**
 * Navigation of the group space (/<holding>/group/..., docs/vue-groupe.md).
 * Entering the group replaces the company sidebar with this one: only the
 * group views, no company page. URLs are relative to /<holding>/group.
 *
 * Expert mode: five views, each answering the questions of a group owner or
 * their accountant (how is the group doing, who holds what, where is the
 * cash, what are the taxes, what is behind a figure). Simple mode: four
 * plain pages under /simple (docs/mode-simple.md).
 */
export const groupNavGroups: NavGroup[] = [
  {
    items: [
      { title: "Pilotage", url: "/", icon: Gauge },
      { title: "Structure", url: "/structure", icon: Network },
      { title: "Trésorerie", url: "/treasury", icon: Wallet },
      { title: "Fiscalité", url: "/tax", icon: Landmark },
      { title: "Opérations", url: "/operations", icon: BookOpen },
    ],
  },
]

export const simpleGroupNavGroups: NavGroup[] = [
  {
    items: [
      { title: "Accueil du groupe", url: "/simple", icon: Home },
      { title: "Mes sociétés", url: "/simple/societes", icon: Building2 },
      { title: "Qui possède quoi", url: "/simple/qui-possede-quoi", icon: Network },
      { title: "Argent entre mes sociétés", url: "/simple/argent-entre-societes", icon: ArrowLeftRight },
    ],
  },
]

export function groupNavGroupsFor(mode: DisplayMode): NavGroup[] {
  return mode === "simple" ? simpleGroupNavGroups : groupNavGroups
}

/** The group space segment of a company path. */
export const GROUP_SPACE = "/group"

/** The home of the group space in a mode, relative to /<holding>/group. */
export const GROUP_HOME: Record<DisplayMode, string> = { expert: "/", simple: "/simple" }

/** Where the group of a holding opens in a mode: /<holding>/group or /<holding>/group/simple. */
export function groupHomePath(holdingRef: string, mode: DisplayMode): string {
  return mode === "simple" ? `/${holdingRef}${GROUP_SPACE}/simple` : `/${holdingRef}${GROUP_SPACE}`
}

/**
 * The pages of the first group space (twelve pages) and the view that now
 * holds what each showed, with the tab to open (?vue=). Old links and
 * bookmarks keep working (the old page redirects).
 */
export const LEGACY_GROUP_PAGES: Record<string, string> = {
  "/companies": "/structure?vue=societes",
  "/persons": "/structure?vue=associes",
  "/participations": "/structure?vue=participations",
  "/comparison": "/?vue=comparaison",
  "/evolution": "/?vue=evolution",
  "/ratios": "/?vue=ratios",
  "/deadlines": "/tax?vue=echeances",
  "/eliminations": "/operations?vue=eliminations",
  "/transactions": "/operations?vue=transactions",
  "/ledger": "/operations?vue=grand-livre",
}

/** The new address of an old group page of a holding: "/alpha/group/structure?vue=societes". */
export function legacyGroupUrl(holdingRef: string, oldPath: string): string {
  const target = LEGACY_GROUP_PAGES[oldPath] ?? "/"
  return target.startsWith("/?") ? `/${holdingRef}${GROUP_SPACE}${target.slice(1)}` : `/${holdingRef}${GROUP_SPACE}${target === "/" ? "" : target}`
}

/**
 * The path inside the group space ("/" for /<holding>/group, "/treasury"...)
 * of a company-relative path, or null outside the group space.
 */
export function groupRelativePath(relativePath: string): string | null {
  if (relativePath === GROUP_SPACE || relativePath === `${GROUP_SPACE}/`) return "/"
  return relativePath.startsWith(`${GROUP_SPACE}/`) ? relativePath.slice(GROUP_SPACE.length) : null
}

/** Whether a group path belongs to the simple pages (/simple...). */
export const isSimpleGroupPath = (groupPath: string) => groupPath === "/simple" || groupPath.startsWith("/simple/")

/**
 * The group nav entry of a path inside the group space (longest prefix
 * wins), looked up in the navigation of the path's own mode, so a simple
 * page opened in expert mode still has its title.
 */
export function findGroupNavEntry(groupPath: string): { group: string; title: string; url: string } | null {
  const groups = isSimpleGroupPath(groupPath) ? simpleGroupNavGroups : groupNavGroups
  let best: { group: string; title: string; url: string } | null = null
  for (const group of groups) {
    for (const item of group.items) {
      const match = item.url === "/" ? groupPath === "/" : groupPath === item.url || groupPath.startsWith(`${item.url}/`)
      if (match && (!best || item.url.length > best.url.length)) best = { group: group.label ?? "", title: item.title, url: item.url }
    }
  }
  return best
}
