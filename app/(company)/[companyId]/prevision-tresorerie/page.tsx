import { getCurrentUser } from '@/lib/session'
import { displayModeForUser } from '@/lib/appearance/display-mode.service'
import { CashForecastPage } from '@/components/features/cash-forecast/cash-forecast-page'

export const metadata = { title: 'Prévision de trésorerie' }

/**
 * Prévision de trésorerie (docs/prevision-tresorerie.md), in the words of
 * the user's display mode (docs/mode-simple.md). The company layout has
 * already checked that the user is a member; the API checks the rights.
 */
export default async function CashForecastRoute({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params
  const user = await getCurrentUser()
  const { mode } = await displayModeForUser(user?.id)
  return <CashForecastPage key={companyId} companyId={companyId} mode={mode} />
}
