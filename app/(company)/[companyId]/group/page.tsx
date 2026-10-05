import { redirect } from 'next/navigation'

import { GroupPilotageView } from '@/components/features/group/pilotage-view'
import { groupHomePath } from '@/components/layout/group-nav-config'
import { displayModeForUser } from '@/lib/appearance/display-mode.service'
import { getCurrentUser } from '@/lib/session'

/**
 * The group's home: Pilotage, or the simple group home in simple mode
 * (docs/vue-groupe.md). A link with parameters (?vue=) opens the view it
 * targets. The company layout has already checked access to the holding.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { companyId } = await params
  const query = await searchParams
  const user = await getCurrentUser()
  const { mode } = await displayModeForUser(user?.id)
  if (mode === 'simple' && Object.keys(query).length === 0) redirect(groupHomePath(companyId, mode))
  return <GroupPilotageView />
}
