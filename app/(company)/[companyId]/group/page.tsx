import { redirect } from 'next/navigation'

import { GroupPilotageView } from '@/components/features/group/pilotage-view'
import { groupHomePath, groupTabUrl } from '@/components/layout/group-nav-config'
import { displayModeForUser } from '@/lib/appearance/display-mode.service'
import { getCurrentUser } from '@/lib/session'

/**
 * The group's home: Pilotage, Synthèse, or the simple group home in simple
 * mode (docs/vue-groupe.md). A link to a former tab of Pilotage (?vue=)
 * opens its page; another link with parameters stays on Pilotage. The
 * company layout has already checked access to the holding.
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
  const target = groupTabUrl(companyId, 'pilotage', query.vue)
  if (target) redirect(target)
  const user = await getCurrentUser()
  const { mode } = await displayModeForUser(user?.id)
  if (mode === 'simple' && Object.keys(query).length === 0) redirect(groupHomePath(companyId, mode))
  return <GroupPilotageView />
}
