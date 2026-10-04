"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import {
  findSettingsEntry,
  visibleSettingsGroups,
  type InstanceSettingsLinks,
  type InstanceSettingsPage,
} from "@/components/layout/settings-nav-config"
import { NavUser } from "@/components/layout/nav-user"
import { useVisibleUserMenu } from "@/components/layout/user-menu-context"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

/** Version of the running instance, shown to everyone in the footer. */
export interface SidebarVersion {
  version: string
  commit: string | null
}

export interface LastCompany {
  slug: string
  name: string
}

/**
 * Sidebar of the pages outside a company (companies, account, instance): a
 * link back to the last company the user opened, then the settings
 * navigation. Same frame, footer and behaviour as the company sidebar.
 */
export function SettingsSidebar({
  lastCompany,
  isAdmin,
  version,
  instanceLinks,
  instancePages,
  ...props
}: {
  lastCompany: LastCompany | null
  isAdmin: boolean
  version?: SidebarVersion
  /** The instance's own versions of the administrators' pages (instanceSettingsLinks slot), for a non administrator. */
  instanceLinks?: InstanceSettingsLinks | null
  /** The instance's own settings pages (instanceSettingsPages slot). */
  instancePages?: readonly InstanceSettingsPage[] | null
} & React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname() ?? ""
  const { isMobile, setOpenMobile } = useSidebar()
  const activeUrl = findSettingsEntry(pathname, instanceLinks, instancePages)?.url
  const visibleMenu = useVisibleUserMenu()
  const closeOnPhone = () => {
    if (isMobile) setOpenMobile(false)
  }

  const back = lastCompany
    ? { href: `/${lastCompany.slug}`, title: lastCompany.name, hint: "Retour à la société" }
    : { href: "/companies", title: "Mes sociétés", hint: "Choisir une société" }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip={lastCompany ? `Retour à ${lastCompany.name}` : "Mes sociétés"}>
              <Link href={back.href} onClick={closeOnPhone}>
                <span
                  aria-hidden
                  className="bg-background flex size-8 shrink-0 items-center justify-center rounded-md border"
                >
                  <ArrowLeft className="size-4" />
                </span>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="text-sidebar-foreground/70 truncate text-xs">{back.hint}</span>
                  <span className="truncate font-medium">{back.title}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Paramètres" className="contents">
          {visibleSettingsGroups(isAdmin, visibleMenu, instanceLinks, instancePages).map((group, index) => (
            <SidebarGroup key={group.label ?? index} className="py-1">
              {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = item.url === activeUrl
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                        <Link href={item.url} aria-current={isActive ? "page" : undefined} onClick={closeOnPhone}>
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
      </SidebarContent>
      <SidebarFooter>
        {version ? (
          <VersionLine
            version={version}
            updatesUrl={isAdmin ? (visibleMenu.includes("updates") ? "/settings/updates" : null) : (instanceLinks?.updates ?? null)}
            onNavigate={closeOnPhone}
          />
        ) : null}
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/**
 * "Kledg v0.1.0 · abc1234" above the user menu. Everyone sees which version
 * runs; instance administrators who may manage updates get a link to the
 * "Mises à jour" page (or the instance's own page, instanceSettingsLinks).
 * Hidden when the sidebar is collapsed to icons.
 */
function VersionLine({
  version,
  updatesUrl,
  onNavigate,
}: {
  version: SidebarVersion
  updatesUrl: string | null
  onNavigate: () => void
}) {
  const label = (
    <>
      Kledg <span className="num">v{version.version}</span>
      {version.commit ? <span className="num text-sidebar-foreground/50"> · {version.commit.slice(0, 7)}</span> : null}
    </>
  )
  const className = "text-sidebar-foreground/60 truncate px-2 text-xs group-data-[collapsible=icon]:hidden"
  return updatesUrl ? (
    <Link href={updatesUrl} onClick={onNavigate} className={`${className} hover:text-sidebar-foreground block hover:underline pointer-coarse:py-3.5`} title="Mises à jour">
      {label}
    </Link>
  ) : (
    <p className={className}>{label}</p>
  )
}
