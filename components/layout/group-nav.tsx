"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"

import { findGroupNavEntry, groupNavGroupsFor, groupRelativePath, GROUP_SPACE } from "@/components/layout/group-nav-config"
import type { DisplayMode } from "@/lib/appearance/display-mode"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import type { GroupSummary } from "@/lib/group/get-group-summary.service"

/**
 * The sidebar menu of the group space: only the group views of the user's
 * display mode (five views in expert mode, four plain pages in simple
 * mode), prefixed with /<holding>/group. One entry is active at a time (longest prefix), and the
 * phone drawer closes after navigating, as in the company navigation.
 */
export function GroupNav({ mode = "expert" }: { mode?: DisplayMode }) {
  const pathname = usePathname() ?? ""
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const { isMobile, setOpenMobile } = useSidebar()
  const base = companyId ? `/${companyId}${GROUP_SPACE}` : GROUP_SPACE
  const groupPath = companyId ? (groupRelativePath(pathname.slice(companyId.length + 1) || "/") ?? "/") : "/"
  const activeUrl = findGroupNavEntry(groupPath)?.url

  return (
    <nav aria-label="Navigation du groupe">
      {groupNavGroupsFor(mode).map((group, index) => (
        <SidebarGroup key={group.label ?? index} className="py-1">
          {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
          <SidebarMenu>
            {group.items.map((item) => {
              const isActive = item.url === activeUrl
              return (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                    <Link
                      href={item.url === "/" ? base : `${base}${item.url}`}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => {
                        if (isMobile) setOpenMobile(false)
                      }}
                    >
                      <item.icon aria-hidden />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </nav>
  )
}

/** The group of the holding in the URL (GET /api/group/summary), loaded while the group space is open. */
export function useGroupSummary(companyId: string | undefined, enabled: boolean): GroupSummary | null {
  const [loaded, setLoaded] = React.useState<{ companyId: string; summary: GroupSummary } | null>(null)
  React.useEffect(() => {
    if (!enabled || !companyId) return
    let cancelled = false
    fetch(`/api/group/summary?${new URLSearchParams({ companyId })}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<GroupSummary>) : null))
      .then((summary) => {
        if (!cancelled && summary) setLoaded({ companyId, summary })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [companyId, enabled])
  // Kept with the holding it belongs to: another group never shows it.
  return enabled && loaded && loaded.companyId === companyId ? loaded.summary : null
}
