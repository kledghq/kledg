import {
  ArrowLeftRight,
  BookOpen,
  Building2,
  CalendarClock,
  Gauge,
  GitCompareArrows,
  LayoutDashboard,
  LineChart,
  ListMinus,
  PieChart,
  Users,
  Wallet,
} from "lucide-react"
import type { NavGroup } from "@/components/layout/nav-config"

/**
 * Navigation of the group space (/<holding>/group/..., docs/vue-groupe.md).
 * Entering the group replaces the company sidebar with this one: only the
 * group pages, no company page. URLs are relative to /<holding>/group.
 *
 * Room for later: Rémunération and Valorisation (left out by decision) will
 * go into "Structure", next to Associés et dirigeants.
 */
export const groupNavGroups: NavGroup[] = [
  { items: [{ title: "Vue d'ensemble", url: "/", icon: LayoutDashboard }] },
  {
    label: "Analyse",
    items: [
      { title: "Sociétés", url: "/companies", icon: Building2 },
      { title: "Comparaison", url: "/comparison", icon: GitCompareArrows },
      { title: "Évolution", url: "/evolution", icon: LineChart },
      { title: "Trésorerie", url: "/treasury", icon: Wallet },
      { title: "Ratios", url: "/ratios", icon: Gauge },
    ],
  },
  {
    label: "Intragroupe",
    items: [
      { title: "Éliminations", url: "/eliminations", icon: ListMinus },
      { title: "Participations", url: "/participations", icon: PieChart },
    ],
  },
  { label: "Structure", items: [{ title: "Associés et dirigeants", url: "/persons", icon: Users }] },
  { label: "Obligations", items: [{ title: "Impôts et échéances", url: "/deadlines", icon: CalendarClock }] },
  {
    label: "Comptabilité",
    items: [
      { title: "Transactions", url: "/transactions", icon: ArrowLeftRight },
      { title: "Grand livre combiné", url: "/ledger", icon: BookOpen },
    ],
  },
]

/** The group space segment of a company path. */
export const GROUP_SPACE = "/group"

/**
 * The path inside the group space ("/" for /<holding>/group, "/treasury"...)
 * of a company-relative path, or null outside the group space.
 */
export function groupRelativePath(relativePath: string): string | null {
  if (relativePath === GROUP_SPACE || relativePath === `${GROUP_SPACE}/`) return "/"
  return relativePath.startsWith(`${GROUP_SPACE}/`) ? relativePath.slice(GROUP_SPACE.length) : null
}

/** The group nav entry of a path inside the group space (longest prefix wins). */
export function findGroupNavEntry(groupPath: string): { group: string; title: string; url: string } | null {
  let best: { group: string; title: string; url: string } | null = null
  for (const group of groupNavGroups) {
    for (const item of group.items) {
      const match = item.url === "/" ? groupPath === "/" : groupPath === item.url || groupPath.startsWith(`${item.url}/`)
      if (match && (!best || item.url.length > best.url.length)) best = { group: group.label ?? "", title: item.title, url: item.url }
    }
  }
  return best
}
