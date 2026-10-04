import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { getAppearance } from '@/lib/appearance/appearance.service'
import { getDisplayMode } from '@/lib/appearance/display-mode.service'
import { PageHeader } from '@/components/shared'
import { AppearanceSettings } from '@/components/features/account/appearance/appearance-settings'
import { DisplayModeCard } from '@/components/features/account/appearance/display-mode-card'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Apparence' }

/** The signed-in user's display mode (simple or expert), theme and chart colours. */
export default async function AppearancePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader
        title="Apparence"
        description="Le mode d'affichage, le thème de l'interface et les couleurs des graphiques, avec un aperçu avant d'enregistrer."
      />
      <DisplayModeCard initial={(await getDisplayMode(user.id)).mode} />
      <AppearanceSettings initial={await getAppearance(user)} />
    </div>
  )
}
