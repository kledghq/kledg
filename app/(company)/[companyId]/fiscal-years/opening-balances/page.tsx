'use client'

import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/shared'
import { OpeningBalancesForm } from '@/components/features/onboarding/opening-balances-form'
import { useCompanyOnboarding } from '@/components/features/onboarding/use-company-onboarding'
import { docsUrl } from '@/lib/docs-links'

/** Opening balances (bilan d'ouverture) of a company that existed before Kledg. */
export default function OpeningBalancesPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const { data } = useCompanyOnboarding(companyId)

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Bilan d'ouverture"
        description="Votre société existait avant Kledg&nbsp;: reprenez les soldes de son dernier bilan pour que les comptes de l'exercice partent des bons chiffres."
        docsHref={docsUrl('fiscalYear')}
      />
      <OpeningBalancesForm companyId={companyId} canEdit={data?.canManage ?? false} />
    </div>
  )
}
