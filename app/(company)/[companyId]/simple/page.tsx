import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/session'
import { loadSimpleHomeForUser } from '@/lib/simple/load-simple-home.service'
import { SimpleHome } from '@/components/features/simple/simple-home'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Accueil' }

/**
 * Home of the simple mode (docs/mode-simple.md). Reachable in both modes:
 * the mode is a display preference, it guards nothing. The company layout
 * has already checked that the user is a member.
 */
export default async function SimpleHomePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const page = await loadSimpleHomeForUser(user, companyId)
  if (!page) redirect('/companies')
  return <SimpleHome home={page.home} companyName={page.companyName} companySlug={page.slug} userName={user.name} />
}
