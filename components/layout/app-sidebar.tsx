"use client"

import * as React from "react"
import { useParams, usePathname } from "next/navigation"
import { SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"

import type { DisplayMode } from "@/lib/appearance/display-mode"
import type { NavFeatureRefs } from "@/lib/companies/nav-features"
import { NOTHING_HIDDEN, type SidebarHidden } from "@/lib/navigation/sidebar-preferences"
import { accountApi } from "@/components/features/account/account-api"
import { findNavEntry, navGroupsFor, titleNavGroupsFor, type NavCountKey } from "@/components/layout/nav-config"
import { companyNavGroups, NavMain } from "@/components/layout/nav-main"
import { revealItem } from "@/components/layout/sidebar-menu"
import { SidebarMenuEditor } from "@/components/layout/sidebar-menu-editor"
import { GroupNav, useGroupSummary } from "@/components/layout/group-nav"
import { groupRelativePath } from "@/components/layout/group-nav-config"
import { NavUser } from "@/components/layout/nav-user"
import { TeamSwitcher, type SwitcherCompany } from "@/components/layout/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
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
 * The user's sidebar menu in the company in the URL (docs/modes-et-menu.md):
 * what the company layout loaded (`initial`, by company id and slug), then
 * the user's changes, applied at once and saved with
 * PUT /api/companies/[id]/sidebar-preferences. A failed save puts the menu
 * back as it was and says why.
 */
function useSidebarHidden(companyId: string | undefined, initial: Readonly<Record<string, SidebarHidden>>) {
  const [changed, setChanged] = React.useState<Record<string, SidebarHidden>>({})
  const hidden = companyId ? (changed[companyId] ?? initial[companyId] ?? NOTHING_HIDDEN) : NOTHING_HIDDEN
  const update = React.useCallback(
    (next: SidebarHidden) => {
      if (!companyId) return
      const previous = hidden
      setChanged((all) => ({ ...all, [companyId]: next }))
      accountApi(`/api/companies/${encodeURIComponent(companyId)}/sidebar-preferences`, { method: "PUT", body: next }).catch((error: Error) => {
        setChanged((all) => ({ ...all, [companyId]: previous }))
        toast.error(error.message)
      })
    },
    [companyId, hidden],
  )
  return [hidden, update] as const
}

/**
 * The sidebar of the company pages. In the group space (/<holding>/group/...)
 * it becomes the group's: the switcher shows the group as the current
 * selection and the menu lists only the group pages (docs/vue-groupe.md);
 * choosing a company in the switcher brings its own navigation back.
 * The company menu is the one of the user's display mode, less what the
 * user hid in this company; "Personnaliser le menu", at its bottom, opens
 * the editor (the group space has no editor: its menu is short).
 */
export function AppSidebar({
  companies,
  holdingRefs,
  featureRefs,
  mode = "expert",
  sidebarPreferences = {},
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  companies?: SwitcherCompany[]
  holdingRefs?: string[]
  featureRefs?: NavFeatureRefs
  mode?: DisplayMode
  /** What the user hid, by company id and slug (lib/navigation/sidebar-preferences.service.ts). */
  sidebarPreferences?: Readonly<Record<string, SidebarHidden>>
}) {
  const params = useParams()
  const companyId = params?.companyId as string | undefined
  const pathname = usePathname() ?? ""
  const inGroup = companyId !== undefined && groupRelativePath(pathname.slice(companyId.length + 1)) !== null
  const counts = useSimpleCounts(companyId, mode === "simple" && !inGroup)
  const group = useGroupSummary(companyId, inGroup)
  const [hidden, setHidden] = useSidebarHidden(companyId, sidebarPreferences)
  const [editing, setEditing] = React.useState(false)
  const { isMobile, setOpenMobile } = useSidebar()
  const groups = navGroupsFor(mode)
  const titleGroups = titleNavGroupsFor(mode)
  const menuGroups = companyNavGroups(groups, companyId, holdingRefs, featureRefs)
  const relativePath = companyId ? pathname.slice(companyId.length + 1) || "/" : pathname
  const currentUrl = findNavEntry(relativePath, titleGroups)?.url
  const company = companies?.find((c) => c.id === companyId || c.slug === companyId)
  const openEditor = () => {
    // On phones the drawer closes first: the editor takes the screen, and the menu shows the result when reopened.
    if (isMobile) setOpenMobile(false)
    setEditing(true)
  }
  return (
    <>
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader>
          <TeamSwitcher initialCompanies={companies} holdingRefs={holdingRefs} group={inGroup ? { summary: group } : undefined} />
        </SidebarHeader>
        <SidebarContent>
          {inGroup ? (
            <GroupNav mode={mode} />
          ) : (
            <>
              <NavMain
                groups={groups}
                titleGroups={titleGroups}
                holdingRefs={holdingRefs}
                featureRefs={featureRefs}
                counts={counts}
                hidden={hidden}
                onReveal={(url) => setHidden(revealItem(hidden, menuGroups, url))}
              />
              <SidebarGroup className="mt-auto py-1">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton tooltip="Personnaliser le menu" className="text-muted-foreground" onClick={openEditor}>
                      <SlidersHorizontal aria-hidden />
                      <span>Personnaliser le menu</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
            </>
          )}
        </SidebarContent>
        <SidebarFooter>
          <NavUser />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      {inGroup ? null : (
        <SidebarMenuEditor
          open={editing}
          onOpenChange={setEditing}
          groups={menuGroups}
          hidden={hidden}
          onChange={setHidden}
          currentUrl={currentUrl}
          companyName={company?.name}
        />
      )}
    </>
  )
}
