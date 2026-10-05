import {
  ArrowLeftRight,
  BookOpen,
  Building2,
  CalendarClock,
  Combine,
  Gauge,
  GitCompareArrows,
  Home,
  Landmark,
  LineChart,
  type LucideIcon,
  Network,
  Percent,
  PieChart,
  Receipt,
  Scale,
  Users,
  Wallet,
} from "lucide-react"
import type { NavGroup } from "@/components/layout/nav-config"
import type { DisplayMode } from "@/lib/appearance/display-mode"

/**
 * Navigation of the group space (/<holding>/group/..., docs/vue-groupe.md).
 * Entering the group replaces the company sidebar with this one: only the
 * group pages, no company page. URLs are relative to /<holding>/group.
 *
 * Expert mode: five views, each answering the questions of a group owner or
 * their accountant (how is the group doing, who holds what, where is the
 * cash, what are the taxes, what is behind a figure). Each view is a group
 * of the sidebar and each of its pages an entry, with its own address.
 * Simple mode: four plain pages under /simple (docs/mode-simple.md).
 */

export type GroupViewId = "pilotage" | "structure" | "treasury" | "tax" | "operations"

export interface GroupPage {
  /** The id the page had as a tab of its view (?vue=), kept for old links. */
  id: string
  title: string
  url: string
  icon: LucideIcon
}

export interface GroupView {
  id: GroupViewId
  title: string
  /** The first page is the view's address. */
  pages: GroupPage[]
}

export const GROUP_VIEWS: GroupView[] = [
  {
    id: "pilotage",
    title: "Pilotage",
    pages: [
      { id: "synthese", title: "Synthèse", url: "/", icon: Gauge },
      { id: "comparaison", title: "N et N-1", url: "/comparison", icon: GitCompareArrows },
      { id: "evolution", title: "Évolution", url: "/evolution", icon: LineChart },
      { id: "ratios", title: "Ratios", url: "/ratios", icon: Percent },
    ],
  },
  {
    id: "structure",
    title: "Structure",
    pages: [
      { id: "organigramme", title: "Organigramme", url: "/structure", icon: Network },
      { id: "associes", title: "Associés et dirigeants", url: "/structure/persons", icon: Users },
      { id: "participations", title: "Participations", url: "/structure/participations", icon: PieChart },
      { id: "societes", title: "Sociétés", url: "/structure/companies", icon: Building2 },
    ],
  },
  {
    id: "treasury",
    title: "Trésorerie",
    pages: [
      { id: "soldes", title: "Soldes et perspectives", url: "/treasury", icon: Wallet },
      { id: "flux", title: "Flux entre sociétés", url: "/treasury/flows", icon: ArrowLeftRight },
    ],
  },
  {
    id: "tax",
    title: "Fiscalité",
    pages: [
      { id: "impot", title: "Impôt sur les sociétés", url: "/tax", icon: Landmark },
      { id: "integration", title: "Intégration fiscale", url: "/tax/integration", icon: Combine },
      { id: "echeances", title: "Échéances", url: "/tax/deadlines", icon: CalendarClock },
    ],
  },
  {
    id: "operations",
    title: "Opérations",
    pages: [
      { id: "transactions", title: "Transactions", url: "/operations", icon: Receipt },
      { id: "grand-livre", title: "Grand livre combiné", url: "/operations/ledger", icon: BookOpen },
      { id: "eliminations", title: "Éliminations", url: "/operations/eliminations", icon: Scale },
    ],
  },
]

/** A page of a view by its id; the view's first page when the id is unknown. */
export function groupPage(viewId: GroupViewId, pageId?: string): GroupPage {
  const view = GROUP_VIEWS.find((v) => v.id === viewId)!
  return view.pages.find((p) => p.id === pageId) ?? view.pages[0]
}

export const groupNavGroups: NavGroup[] = GROUP_VIEWS.map((view) => ({
  label: view.title,
  items: view.pages.map(({ title, url, icon }) => ({ title, url, icon })),
}))

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
 * The pages of the first group space (twelve pages) that moved, and their
 * page now. Old links and bookmarks keep working (the old page redirects).
 */
export const LEGACY_GROUP_PAGES: Record<string, string> = {
  "/companies": "/structure/companies",
  "/persons": "/structure/persons",
  "/participations": "/structure/participations",
  "/deadlines": "/tax/deadlines",
  "/eliminations": "/operations/eliminations",
  "/transactions": "/operations",
  "/ledger": "/operations/ledger",
}

/** The new address of an old group page of a holding: "/alpha/group/structure/companies". */
export function legacyGroupUrl(holdingRef: string, oldPath: string): string {
  const target = LEGACY_GROUP_PAGES[oldPath] ?? "/"
  return `/${holdingRef}${GROUP_SPACE}${target === "/" ? "" : target}`
}

/**
 * The page a link to a tab of a view (?vue=, when the views had tabs) now
 * opens, or null when the link names no other page of the view.
 */
export function groupTabUrl(holdingRef: string, viewId: GroupViewId, vue: unknown): string | null {
  if (typeof vue !== "string") return null
  const view = GROUP_VIEWS.find((v) => v.id === viewId)!
  const page = view.pages.find((p) => p.id === vue)
  if (!page || page === view.pages[0]) return null
  return `/${holdingRef}${GROUP_SPACE}${page.url}`
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
