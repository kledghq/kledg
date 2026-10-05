"use client"

import * as React from "react"
import { useParams } from "next/navigation"

import type { DisplayMode } from "@/lib/appearance/display-mode"
import { navGroupsFor, type NavCountKey } from "@/components/layout/nav-config"
import { NavMain } from "@/components/layout/nav-main"
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

export function AppSidebar({
  companies,
  holdingRefs,
  mode = "expert",
  ...props
}: React.ComponentProps<typeof Sidebar> & { companies?: SwitcherCompany[]; holdingRefs?: string[]; mode?: DisplayMode }) {
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const counts = useSimpleCounts(companyId, mode === "simple")
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher initialCompanies={companies} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={navGroupsFor(mode)} holdingRefs={holdingRefs} counts={counts} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
