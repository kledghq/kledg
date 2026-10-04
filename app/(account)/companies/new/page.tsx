import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { isGlobalAdmin } from '@/lib/rbac/authorize'
import { PageHeader } from '@/components/shared'
import { CompanyWizard } from '@/components/features/onboarding/company-wizard'
import { docsUrl } from '@/lib/docs-links'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Créer une société' }

/** Company creation wizard. Instance administrators create companies. */
export default async function NewCompanyPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!isGlobalAdmin(user)) redirect('/companies')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Créer une société"
        description="Quatre étapes courtes&nbsp;: l'identité de la société, son exercice et ses impôts, son capital, puis une vérification."
        docsHref={docsUrl('firstSteps')}
      />
      <CompanyWizard />
    </div>
  )
}
