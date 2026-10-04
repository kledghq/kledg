'use client'

import { BarChart3 } from 'lucide-react'

import { docsUrl } from '@/lib/docs-links'
import { OnboardingEmptyState } from './onboarding-empty-state'
import { useCompanyOnboarding } from './use-company-onboarding'

/**
 * Above the list of statements while the company has no entry yet: the
 * statements would all be empty, so point to what fills them.
 */
export function ReportsEmptyHint({ companyId }: { companyId: string }) {
  const { data } = useCompanyOnboarding(companyId)
  if (!data || data.counts.entries > 0) return null
  return (
    <OnboardingEmptyState
      companyId={companyId}
      icon={BarChart3}
      title="Vos états sont encore vides"
      description="Le bilan, le compte de résultat et la balance se calculent à partir des écritures, et la société n'en a pas encore."
      steps={['bank', 'history']}
      fallback={{ label: 'Saisir une écriture', href: `/${companyId}/entries/new` }}
      docsHref={docsUrl('balanceSheet')}
      docsLabel="Lire son bilan"
    />
  )
}
