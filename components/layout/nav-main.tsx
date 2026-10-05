"use client"

import Link from "next/link"
import { useParams, usePathname } from "next/navigation"

import { EyeOff } from "lucide-react"

import { findNavEntry, type NavCountKey, type NavGroup } from "@/components/layout/nav-config"
import { applySidebarHidden } from "@/components/layout/sidebar-menu"
import type { NavFeatureRefs } from "@/lib/companies/nav-features"
import { NOTHING_HIDDEN, type SidebarHidden } from "@/lib/navigation/sidebar-preferences"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

/**
 * The groups of a company menu its company shows: entries marked holdingOnly
 * only when the company is in `holdingRefs` (ids and slugs), entries with a
 * `feature` when it is in that feature's `featureRefs`. The sidebar and its
 * editor (sidebar-menu-editor.tsx) list the same entries.
 */
export function companyNavGroups(
  groups: readonly NavGroup[],
  companyId: string | undefined,
  holdingRefs: readonly string[] = [],
  featureRefs: Partial<NavFeatureRefs> = {},
): NavGroup[] {
  const isHolding = companyId !== undefined && holdingRefs.includes(companyId)
  const hasFeature = (feature: keyof NavFeatureRefs) => companyId !== undefined && (featureRefs[feature] ?? []).includes(companyId)
  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => (!item.holdingOnly || isHolding) && (!item.feature || hasFeature(item.feature))),
  }))
}

/**
 * Company navigation. One item is active at a time: the entry whose URL is
 * the longest prefix of the current path, so detail pages (an account, an
 * entry) keep their section highlighted. The entry is looked up in
 * `titleGroups` (the expert navigation in Standard mode), so a page the menu
 * does not list highlights nothing rather than a shorter neighbour. Entries
 * are filtered by company (companyNavGroups), then by what the user hid
 * (`hidden`, docs/modes-et-menu.md); on a page the user hid, the menu says
 * "Page masquée du menu" with a "Réafficher" link (`onReveal`). An entry
 * with a `count` shows it when `counts` has a positive value for it.
 */
export function NavMain({
  groups,
  titleGroups = groups,
  holdingRefs = [],
  featureRefs = {},
  counts = {},
  hidden = NOTHING_HIDDEN,
  onReveal,
}: {
  groups: NavGroup[]
  titleGroups?: readonly NavGroup[]
  holdingRefs?: readonly string[]
  featureRefs?: Partial<NavFeatureRefs>
  counts?: Partial<Record<NavCountKey, number>>
  hidden?: SidebarHidden
  onReveal?: (url: string) => void
}) {
  const pathname = usePathname() ?? ""
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const { isMobile, setOpenMobile } = useSidebar()

  const base = companyId ? `/${companyId}` : ""
  const relativePath = companyId ? pathname.slice(base.length) || "/" : pathname
  const current = findNavEntry(relativePath, titleGroups)

  const href = (url: string) => (url === "/" ? base || "/" : `${base}${url}`)
  const companyGroups = companyNavGroups(groups, companyId, holdingRefs, featureRefs)
  const visibleGroups = applySidebarHidden(companyGroups, hidden)
  const listed = (list: readonly NavGroup[], url: string | undefined) => url !== undefined && list.some((group) => group.items.some((item) => item.url === url))
  const activeUrl = listed(visibleGroups, current?.url) ? current?.url : undefined
  // The current page is an entry of this menu that the user hid: say so, with a way back.
  const hiddenCurrent = current && !activeUrl && listed(companyGroups, current.url) ? current : null

  return (
    <>
      {visibleGroups.map((group, index) => (
        <SidebarGroup key={group.label ?? index} className="py-1">
          {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
          <SidebarMenu>
            {group.items.map((item) => {
              const isActive = item.url === activeUrl
              const count = item.count ? (counts[item.count] ?? 0) : 0
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
                      {count > 0 ? <span className="sr-only">, {count} à vérifier</span> : null}
                    </Link>
                  </SidebarMenuButton>
                  {count > 0 ? (
                    <SidebarMenuBadge aria-hidden className="num">
                      {count}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
      {hiddenCurrent ? (
        <SidebarGroup className="py-1 group-data-[collapsible=icon]:hidden">
          <p className="text-muted-foreground flex items-center gap-2 px-2 text-xs" role="status">
            <EyeOff aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">Page masquée du menu</span>
            {onReveal ? (
              <button type="button" className="text-link shrink-0 underline-offset-4 hover:underline" onClick={() => onReveal(hiddenCurrent.url)}>
                Réafficher
              </button>
            ) : null}
          </p>
        </SidebarGroup>
      ) : null}
    </>
  )
}
