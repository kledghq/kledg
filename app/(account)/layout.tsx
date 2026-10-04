import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCurrentUser, type CurrentUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { LAST_COMPANY_COOKIE, parseLastCompany } from '@/lib/last-company'
import { AppShell } from '@/components/layout/app-shell'
import { SettingsSidebar, type LastCompany } from '@/components/layout/settings-sidebar'
import { SettingsBreadcrumb } from '@/components/layout/settings-breadcrumb'
import { getDeployedVersion } from '@/lib/updates/version'
import { instanceSettingsLinks, instanceSettingsPages } from '@/components/instance/slots'

/**
 * The last company the user opened, if they can still open it. The cookie
 * is only a hint: a company the user lost access to is never named.
 */
async function lastCompanyOf(user: CurrentUser): Promise<LastCompany | null> {
  const slug = parseLastCompany((await cookies()).get(LAST_COMPANY_COOKIE)?.value)
  if (!slug) return null
  return prisma.company.findFirst({
    where: {
      slug,
      ...(isGlobalAdmin(user) ? {} : { organization: { members: { some: { userId: user.id } } } }),
    },
    select: { slug: true, name: true },
  })
}

/**
 * Pages outside of a company (companies, account and instance settings), in
 * the same frame as company pages, with a settings navigation.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const isAdmin = isGlobalAdmin(user)
  const { version, commit } = getDeployedVersion()
  // An instance may serve its own versions of the administrators' pages to other users (extension point).
  const instanceLinks = isAdmin ? null : await instanceSettingsLinks(user)
  // And may add its own settings pages (extension point).
  const instancePages = await instanceSettingsPages(user)

  return (
    <AppShell
      sidebar={<SettingsSidebar lastCompany={await lastCompanyOf(user)} isAdmin={isAdmin} version={{ version, commit }} instanceLinks={instanceLinks} instancePages={instancePages} />}
      breadcrumb={<SettingsBreadcrumb instanceLinks={instanceLinks} instancePages={instancePages} />}
      user={user}
      isAdmin={isAdmin}
    >
      {children}
    </AppShell>
  )
}
