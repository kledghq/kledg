import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { DisplayModeSwitch } from '@/components/layout/display-mode-switch'
import { AppShell } from '@/components/layout/app-shell'
import { DashboardBreadcrumb } from '@/components/layout/dashboard-breadcrumb'
import { CompanyOverlay } from '@/components/instance/slots'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { listCompaniesForUser } from '@/lib/companies/manage-company.service'
import { listHoldingRefs } from '@/lib/management-fees/holding'
import { listNavFeatureRefs } from '@/lib/companies/nav-features'
import { displayModeForUser } from '@/lib/appearance/display-mode.service'
import { listSidebarPreferences } from '@/lib/navigation/sidebar-preferences.service'
import { sanitizeSidebarHidden } from '@/components/layout/sidebar-menu'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  // The company switcher renders with the list at once, without a
  // "Chargement..." state while the client would fetch it
  const companies = (await listCompaniesForUser(user)).map(({ id, slug, name, logo, legalType }) => ({ id, slug, name, logo, legalType }))
  // Holdings show Frais de gestion in their navigation (one definition: lib/management-fees/holding.ts)
  const holdingRefs = await listHoldingRefs(user, companies.map((company) => company.id))
  // Training organisations and companies deducting VAT by a coefficient show their pages (lib/companies/nav-features.ts)
  const featureRefs = await listNavFeatureRefs(user, companies.map((company) => company.id))
  // Simple, standard or expert navigation: a display preference of the user (docs/modes-et-menu.md), never a permission
  const { mode } = await displayModeForUser(user.id)
  // What the user hid from their menu in each company, so the sidebar renders without a flash (unknown ids ignored)
  const sidebarPreferences = Object.fromEntries(
    Object.entries(await listSidebarPreferences(user, companies)).map(([ref, hidden]) => [ref, sanitizeSidebarHidden(hidden)]),
  )

  return (
    <AppShell
      sidebar={<AppSidebar companies={companies} holdingRefs={holdingRefs} featureRefs={featureRefs} mode={mode} sidebarPreferences={sidebarPreferences} />}
      breadcrumb={<DashboardBreadcrumb mode={mode} />}
      user={user}
      isAdmin={isGlobalAdmin(user)}
      after={<CompanyOverlay user={user} />}
      headerActions={<DisplayModeSwitch key={mode} mode={mode} />}
    >
      {children}
    </AppShell>
  )
}
