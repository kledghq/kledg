import { permanentRedirect } from 'next/navigation'
import { legacyGroupUrl } from '@/components/layout/group-nav-config'

/** A page of the first group space, now a tab of a view (docs/vue-groupe.md): old links keep working. */
export default async function Page({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  permanentRedirect(legacyGroupUrl(companyId, '/ratios'))
}
