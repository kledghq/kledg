import { redirect } from 'next/navigation'

import { GroupStructureView } from '@/components/features/group/structure-view'
import { groupTabUrl } from '@/components/layout/group-nav-config'

/** Structure, Organigramme (docs/vue-groupe.md). A link to a former tab of the view (?vue=) opens its page. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { companyId } = await params
  const target = groupTabUrl(companyId, 'structure', (await searchParams).vue)
  if (target) redirect(target)
  return <GroupStructureView />
}
