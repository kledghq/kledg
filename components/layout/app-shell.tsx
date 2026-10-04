import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { TasksIndicator } from '@/components/layout/tasks-indicator'
import { UserMenuProvider } from '@/components/layout/user-menu-context'
import { USER_MENU_ITEMS } from '@/components/layout/user-menu'
import { filterUserMenu, InstanceBanner } from '@/components/instance/slots'
import type { InstanceActor } from '@/lib/instance/types'
import { UpdateIndicator } from '@/components/layout/update-indicator'
import { HelpMenu } from '@/components/layout/help-menu'
import { isActionAllowed } from '@/lib/instance'
import { approvalPageAvailable } from '@/lib/ai-access/manage-grants.service'

/**
 * The application frame shared by company pages and the settings area:
 * sidebar (drawer on phones), sticky header with breadcrumb, help menu,
 * update notice for administrators, background tasks and theme toggle.
 * Each area brings its own sidebar and breadcrumb. The instance slots
 * (components/instance/slots.tsx) add a banner and filter the user menu.
 */
export async function AppShell({
  sidebar,
  breadcrumb,
  user,
  isAdmin,
  children,
  after,
}: {
  sidebar: React.ReactNode
  breadcrumb: React.ReactNode
  user: InstanceActor
  isAdmin: boolean
  children: React.ReactNode
  /** Rendered after the main content (the company overlay slot of company pages). */
  after?: React.ReactNode
}) {
  // "Actions IA à approuver" is listed only while one of the user's AI
  // connections runs in validation mode or an action still waits for them.
  const showApprovals = await approvalPageAvailable(user.id)
  const visibleMenu = (await filterUserMenu([...USER_MENU_ITEMS], user))
    .map((item) => item.id)
    .filter((id) => id !== 'ai-actions' || showApprovals)
  const onboardingEnabled = await isActionAllowed('onboarding', user)
  return (
    <UserMenuProvider visible={visibleMenu}>
    <SidebarProvider>
      <a
        href="#contenu"
        className="bg-background focus-visible:ring-ring/50 sr-only z-50 rounded-md border px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:ring-[3px]"
      >
        Aller au contenu
      </a>
      {sidebar}
      <SidebarInset className="min-w-0">
        <InstanceBanner user={user} />
        {/* Safe areas (viewport-fit=cover, app/layout.tsx): the header grows
            under the status bar or notch instead of hiding behind it. Its
            icon buttons are 44px on touch screens (app/globals.css). */}
        <header
          data-slot="app-header"
          className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b pt-[env(safe-area-inset-top)] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur md:pr-[max(1.5rem,env(safe-area-inset-right))] md:pl-6"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
            {breadcrumb}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <HelpMenu onboardingEnabled={onboardingEnabled} />
            {isAdmin && <UpdateIndicator />}
            <TasksIndicator />
            <ThemeToggle />
          </div>
        </header>
        <main
          id="contenu"
          className="flex min-w-0 flex-1 flex-col p-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] md:p-6 md:pr-[max(1.5rem,env(safe-area-inset-right))] md:pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          {children}
        </main>
        {after}
      </SidebarInset>
    </SidebarProvider>
    </UserMenuProvider>
  )
}
