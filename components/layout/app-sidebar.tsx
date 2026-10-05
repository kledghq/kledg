"use client"

import * as React from "react"
import { useParams, usePathname } from "next/navigation"

import type { DisplayMode } from "@/lib/appearance/display-mode"
import { navGroupsFor, type NavCountKey } from "@/components/layout/nav-config"
import { NavMain } from "@/components/layout/nav-main"
import { GroupNav, useGroupSummary } from "@/components/layout/group-nav"
import { groupRelativePath } from "@/components/layout/group-nav-config"
import { NavUser } from "@/components/layout/nav-user"
import { TeamSwitcher, type SwitcherCompany } from "@/components/layout/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

/** Event a page dispatches after changing what the simple navigation counts (expenses checked). */
export const SIMPLE_COUNTS_REFRESH_EVENT = "simple:counts-refresh"

/**
 * Counts of the simple navigation (GET /api/companies/[id]/simple/counts),
 * loaded in simple mode only. A failure leaves the entries without count.
 */
function useSimpleCounts(companyId: string | undefined, enabled: boolean) {
  // Counts are kept with the company they belong to, so another company never shows them
  const [loaded, setLoaded] = React.useState<{ companyId: string; counts: Partial<Record<NavCountKey, number>> } | null>(null)
  React.useEffect(() => {
    if (!enabled || !companyId) return
    let cancelled = false
    const load = () => {
      fetch(`/api/companies/${companyId}/simple/counts`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data: Partial<Record<NavCountKey, number>> | null) => {
          if (!cancelled) setLoaded({ companyId, counts: data ?? {} })
        })
        .catch(() => {
          if (!cancelled) setLoaded(null)
        })
    }
    load()
    window.addEventListener(SIMPLE_COUNTS_REFRESH_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(SIMPLE_COUNTS_REFRESH_EVENT, load)
    }
  }, [companyId, enabled])
  return enabled && loaded && loaded.companyId === companyId ? loaded.counts : {}
}

/**
 * The sidebar of the company pages. In the group space (/<holding>/group/...)
 * it becomes the group's: the switcher shows the group as the current
 * selection and the menu lists only the group pages (docs/vue-groupe.md);
 * choosing a company in the switcher brings its own navigation back.
 */
export function AppSidebar({
  companies,
  holdingRefs,
  mode = "expert",
  ...props
}: React.ComponentProps<typeof Sidebar> & { companies?: SwitcherCompany[]; holdingRefs?: string[]; mode?: DisplayMode }) {
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const pathname = usePathname() ?? ""
  const inGroup = companyId !== undefined && groupRelativePath(pathname.slice(companyId.length + 1)) !== null
  const counts = useSimpleCounts(companyId, mode === "simple" && !inGroup)
  const group = useGroupSummary(companyId, inGroup)
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher initialCompanies={companies} holdingRefs={holdingRefs} group={inGroup ? { summary: group } : undefined} />
      </SidebarHeader>
      <SidebarContent>
        {inGroup ? <GroupNav /> : <NavMain groups={navGroupsFor(mode)} holdingRefs={holdingRefs} counts={counts} />}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
