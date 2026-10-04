"use client"

import * as React from "react"

import { navGroups } from "@/components/layout/nav-config"
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

export function AppSidebar({
  companies,
  holdingRefs,
  ...props
}: React.ComponentProps<typeof Sidebar> & { companies?: SwitcherCompany[]; holdingRefs?: string[] }) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher initialCompanies={companies} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={navGroups} holdingRefs={holdingRefs} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
