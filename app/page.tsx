import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { needsSetup } from '@/lib/setup'
import { companyCreationRefusal, isActionAllowed } from '@/lib/instance'

export const dynamic = 'force-dynamic'

/** Entry point: first-run setup, login, or the user's first company. */
export default async function Home() {
  if ((await isActionAllowed('setup')) && (await needsSetup())) redirect('/setup')

  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const company = await prisma.company.findFirst({
    where: isGlobalAdmin(user)
      ? {}
      : { organization: { members: { some: { userId: user.id } } } },
    orderBy: { name: 'asc' },
    select: { slug: true },
  })

  if (company) redirect(`/${company.slug}`)
  // A fresh instance: the administrator starts with the welcome page.
  if (isGlobalAdmin(user) && (await isActionAllowed('onboarding', user))) redirect('/welcome')
  // A user the instance lets create companies starts with the creation wizard.
  if (!isGlobalAdmin(user) && !(await companyCreationRefusal(user))) redirect('/companies/new')
  redirect('/companies')
}
