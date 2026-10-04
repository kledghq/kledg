import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { UpdatesPanel } from '@/components/features/updates/updates-panel'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mises à jour' }

/** Instance updates: version, release notes, GitHub connection. Instance administrators only. */
export default async function UpdatesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!isGlobalAdmin(user)) redirect('/companies')
  return <UpdatesPanel />
}
