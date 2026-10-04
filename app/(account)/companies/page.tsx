import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { PageHeader } from '@/components/shared'
import { CompaniesList } from '@/components/features/companies/companies-list'
import { listArchivedCompanies } from '@/lib/companies/archive-company.service'
import { companyCreationRefusal } from '@/lib/instance'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Sociétés' }

export default async function CompaniesPage() {
  // The page checks the user itself: the (account) layout does not protect
  // the pages it wraps (they render in parallel, and a client navigation
  // fetches this segment without the layout).
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const isAdmin = isGlobalAdmin(user)
  // Users may create companies when the instance policy lets them; a refusal
  // with a link (an upgrade page) keeps the button: the wizard page explains it.
  const refusal = await companyCreationRefusal({ id: user.id, email: user.email, role: user.role })
  const canCreate = !refusal || Boolean(refusal.link)

  const companies = await prisma.company.findMany({
    // Archived companies are hidden; administrators see them below, to restore them.
    where: isAdmin ? { archivedAt: null } : { archivedAt: null, organization: { members: { some: { userId: user.id } } } },
    include: { address: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sociétés"
        description={
          isAdmin
            ? 'Les sociétés gérées sur cette instance.'
            : canCreate
              ? 'Les sociétés auxquelles vous avez accès.'
              : "Les sociétés auxquelles vous avez accès. Un administrateur peut vous en ouvrir d'autres."
        }
      />
      <CompaniesList
        companies={JSON.parse(JSON.stringify(companies))}
        archived={isAdmin ? JSON.parse(JSON.stringify(await listArchivedCompanies())) : []}
        showList
        canCreate={canCreate}
        canManage={isAdmin}
      />
    </div>
  )
}
