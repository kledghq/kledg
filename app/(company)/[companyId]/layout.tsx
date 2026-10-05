import { headers } from 'next/headers'
import { permanentRedirect, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isGlobalAdmin, getUserRolesForCompany } from '@/lib/rbac/authorize'
import { PATH_HEADER } from '@/lib/request-path'
import { grantedPermissions, roleLabelOf } from '@/lib/rbac/granted-permissions'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { AiAssistProvider } from '@/components/features/ai-assist/ai-assist-context'
import { companyAssistants } from '@/lib/ai-access/company-assistants.service'

/**
 * The [companyId] segment is the company slug (/atelier-lumen/entries); a raw
 * id is still accepted and permanently redirected to the slug URL.
 */
export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ companyId: string }>
}) {
  const { companyId: ref } = await params
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  const company =
    (await prisma.company.findUnique({ where: { slug: ref }, select: { id: true, slug: true, name: true } })) ??
    (await prisma.company.findUnique({ where: { id: ref }, select: { id: true, slug: true, name: true } }))

  if (!company) {
    redirect('/companies')
  }

  const admin = isGlobalAdmin(user)
  const roles = admin ? [] : await getUserRolesForCompany(user.id, company.id)
  if (!admin && roles.length === 0) {
    redirect('/companies')
  }

  if (ref !== company.slug) {
    // Same page under the slug: /<id>/reports/balance-sheet?x=1 -> /<slug>/reports/balance-sheet?x=1
    const current = (await headers()).get(PATH_HEADER) ?? `/${ref}`
    const prefix = `/${ref}`
    const rest = current.startsWith(prefix) ? current.slice(prefix.length) : ''
    const target = `/${company.slug}${rest.startsWith('/') || rest.startsWith('?') ? rest : ''}`
    permanentRedirect(target)
  }

  // The assistants the user connected to this company, for "Proposer avec l'IA" (none: no button)
  const assistants = await companyAssistants(user.id, company.id)

  // What the role may do, for the pages to disable what it cannot (the API still checks every request)
  return (
    <CompanyAccessProvider value={{ granted: grantedPermissions(roles, admin), roleLabel: roleLabelOf(roles, admin) }}>
      <AiAssistProvider value={{ companyId: company.id, companyName: company.name, userId: user.id, apps: assistants }}>{children}</AiAssistProvider>
    </CompanyAccessProvider>
  )
}
