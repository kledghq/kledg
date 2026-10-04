'use client'

import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { TiersForm } from '@/components/features/tiers/tiers-form'

export default function NewTiersPage() {
  const params = useParams()
  const { can } = useCompanyAccess()
  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader title="Nouveau tiers" description="Un client ou un fournisseur, avec son compte auxiliaire et ses comptes par défaut." />
      <TiersForm companyId={params.companyId as string} canWrite={can({ entries: ['create'] })} />
    </div>
  )
}
