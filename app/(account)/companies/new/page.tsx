import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { companyCreationRefusal } from '@/lib/instance'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/shared'
import { CompanyWizard } from '@/components/features/onboarding/company-wizard'
import { docsUrl } from '@/lib/docs-links'
import { shouldAskDisplayMode } from '@/lib/appearance/display-mode.service'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Créer une société' }

/**
 * Company creation wizard: instance administrators, and the users the
 * instance policy lets create companies (companyCreationRefusal,
 * lib/instance/policy.ts). Anyone else sees why they may not. On the first
 * run of a user (no company yet, no display mode chosen), a last step asks
 * how they want to use Kledg (simple or expert, docs/mode-simple.md).
 */
export default async function NewCompanyPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const refusal = await companyCreationRefusal({ id: user.id, email: user.email, role: user.role })
  const askDisplayMode = !refusal && (await shouldAskDisplayMode(user.id))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Créer une société"
        description={
          askDisplayMode
            ? "Cinq étapes courtes\u00a0: l'identité de la société, son exercice et ses impôts, son capital, une vérification, puis votre façon d'utiliser Kledg."
            : "Quatre étapes courtes\u00a0: l'identité de la société, son exercice et ses impôts, son capital, puis une vérification."
        }
        docsHref={docsUrl('firstSteps')}
      />
      {refusal ? (
        <EmptyState
          bordered
          title="Création de société indisponible"
          description={refusal.message}
          action={
            refusal.link ? (
              <Button size="sm" asChild>
                <Link href={refusal.link.href}>{refusal.link.label}</Link>
              </Button>
            ) : (
              <Button size="sm" variant="outline" asChild>
                <Link href="/companies">Retour aux sociétés</Link>
              </Button>
            )
          }
        />
      ) : (
        <CompanyWizard askDisplayMode={askDisplayMode} />
      )}
    </div>
  )
}
