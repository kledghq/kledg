import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { AppShell } from '@/components/layout/app-shell'
import { DashboardBreadcrumb } from '@/components/layout/dashboard-breadcrumb'
import { CompanyOverlay } from '@/components/instance/slots'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { listCompaniesForUser } from '@/lib/companies/manage-company.service'
import { listHoldingRefs } from '@/lib/management-fees/holding'

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
  const holdingRefs = await listHoldingRefs(user)

  return (
    <AppShell
      sidebar={<AppSidebar companies={companies} holdingRefs={holdingRefs} />}
      breadcrumb={<DashboardBreadcrumb />}
      user={user}
      isAdmin={isGlobalAdmin(user)}
      after={<CompanyOverlay user={user} />}
    >
      {children}
    </AppShell>
  )
}
