"use client"

import { BookOpen, ChevronsUpDown, Download, LogOut, Settings } from "lucide-react"
import { useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { DOCS_URL } from "@/lib/config"
import { USER_MENU_ITEMS } from "@/components/layout/user-menu"
import { useVisibleUserMenu } from "@/components/layout/user-menu-context"
import { displayName, initials } from "@/components/layout/initials"
import { clearPwaCaches, useInstallPrompt } from "@/components/pwa/install"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"

function Identity({ name, email }: { name: string; email: string }) {
  return (
    <>
      <Avatar className="size-8 rounded-md">
        <AvatarFallback className="rounded-md text-xs font-medium">{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="text-muted-foreground truncate text-xs">{email}</span>
      </div>
    </>
  )
}

/**
 * Account menu in the sidebar footer: who is signed in, the way into the
 * account settings (the settings sidebar then lists every account and
 * instance page), the documentation, "Installer l'application" when the
 * browser offers it (components/pwa) and sign out. Settings navigation is
 * not repeated here.
 */
export function NavUser() {
  const { isMobile, setOpenMobile } = useSidebar()
  const signOutForm = useRef<HTMLFormElement>(null)
  const pathname = usePathname() ?? ""
  const visible = useVisibleUserMenu()
  const { data } = authClient.useSession()
  const { canInstall, install } = useInstallPrompt()
  const authUser = data?.user as { name?: string; email?: string; role?: string } | undefined

  if (!authUser) return null
  const name = displayName(authUser)
  const email = authUser.email ?? ""
  const isAdmin = authUser.role === "admin"

  // Close the drawer after navigating on phones, like the navigation entries.
  const onNavigate = () => {
    if (isMobile) setOpenMobile(false)
  }
  // Sign out is a same-origin POST (app/auth/signout/route.ts): it clears
  // the session cookies and redirects to /login with a full page load, so
  // nothing of the signed-in session stays in the client cache. The assets
  // the service worker stored meanwhile go first (build files, never data).
  const handleSignOut = () => {
    void clearPwaCaches()
      .catch(() => undefined)
      .finally(() => signOutForm.current?.requestSubmit())
  }

  // Entries kept by the instance (filterUserMenu), for this user's role.
  const entries = USER_MENU_ITEMS.filter(
    (item) => item.inMenu && visible.includes(item.id) && (!item.adminOnly || isAdmin),
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Outside the dropdown: its content unmounts when the menu closes. */}
        <form ref={signOutForm} method="post" action="/auth/signout" hidden />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={name}
              aria-label={`Compte de ${name}`}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Identity name={name} email={email} />
              <ChevronsUpDown aria-hidden className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Identity name={name} email={email} />
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {entries.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <DropdownMenuItem key={item.id} asChild>
                    <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                      <Settings aria-hidden />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuItem asChild>
                <a href={DOCS_URL} target="_blank" rel="noreferrer" onClick={onNavigate}>
                  <BookOpen aria-hidden />
                  Documentation
                  <span className="sr-only"> (nouvel onglet)</span>
                </a>
              </DropdownMenuItem>
              {canInstall ? (
                <DropdownMenuItem onSelect={() => void install()}>
                  <Download aria-hidden />
                  Installer l&apos;application
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut}>
              <LogOut aria-hidden />
              Se déconnecter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
