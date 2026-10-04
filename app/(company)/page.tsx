import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isGlobalAdmin } from '@/lib/rbac/authorize'

export default async function DashboardRedirectPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  // First company the user can see (archived ones are hidden), or the companies page
  const company = await prisma.company.findFirst({
    where: isGlobalAdmin(user)
      ? { archivedAt: null }
      : { archivedAt: null, organization: { members: { some: { userId: user.id } } } },
    orderBy: { name: 'asc' },
    select: { slug: true },
  })

  redirect(company ? `/${company.slug}` : '/companies')
}
