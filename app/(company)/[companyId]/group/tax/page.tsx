import { redirect } from 'next/navigation'

import { GroupTaxView } from '@/components/features/group/tax-view'
import { groupTabUrl } from '@/components/layout/group-nav-config'

/** Fiscalité, Impôt sur les sociétés (docs/vue-groupe.md). A link to a former tab of the view (?vue=) opens its page. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { companyId } = await params
  const target = groupTabUrl(companyId, 'tax', (await searchParams).vue)
  if (target) redirect(target)
  return <GroupTaxView />
}
