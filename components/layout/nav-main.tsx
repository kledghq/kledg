"use client"

import Link from "next/link"
import { useParams, usePathname } from "next/navigation"

import { findNavEntry, type NavGroup } from "@/components/layout/nav-config"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

/**
 * Company navigation. One item is active at a time: the entry whose URL is
 * the longest prefix of the current path, so detail pages (an account, an
 * entry) keep their section highlighted. Entries marked holdingOnly appear
 * only when the current company is in `holdingRefs` (ids and slugs).
 */
export function NavMain({ groups, holdingRefs = [] }: { groups: NavGroup[]; holdingRefs?: readonly string[] }) {
  const pathname = usePathname() ?? ""
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const { isMobile, setOpenMobile } = useSidebar()

  const base = companyId ? `/${companyId}` : ""
  const relativePath = companyId ? pathname.slice(base.length) || "/" : pathname
  const activeUrl = findNavEntry(relativePath)?.url

  const href = (url: string) => (url === "/" ? base || "/" : `${base}${url}`)
  const isHolding = companyId !== undefined && holdingRefs.includes(companyId)
  const visibleGroups = groups.map((group) => ({ ...group, items: group.items.filter((item) => !item.holdingOnly || isHolding) }))

  return (
    <>
      {visibleGroups.map((group, index) => (
        <SidebarGroup key={group.label ?? index} className="py-1">
          {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
          <SidebarMenu>
            {group.items.map((item) => {
              const isActive = item.url === activeUrl
              return (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                    <Link
                      href={href(item.url)}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => {
                        // Close the drawer after navigating on phones.
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
    </>
  )
}
