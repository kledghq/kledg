import { redirect } from 'next/navigation'

import { Dashboard } from '@/components/features/dashboard/dashboard'
import { getCurrentUser } from '@/lib/session'
import { displayModeForUser } from '@/lib/appearance/display-mode.service'
import { companyHomePath } from '@/lib/appearance/display-mode'

/**
 * The company's home. In simple mode it opens the simple home
 * (docs/mode-simple.md); a link with parameters (the getting started guide,
 * ?guide=) still opens the dashboard it targets. The company layout has
 * already checked access.
 */
export default async function HomePage({
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
  if (mode === 'simple' && Object.keys(query).length === 0) redirect(companyHomePath(companyId, mode))
  return <Dashboard key={companyId} companyId={companyId} />
}
