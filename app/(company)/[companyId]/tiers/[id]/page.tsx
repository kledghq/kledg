'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { TiersForm, type TiersFormValues } from '@/components/features/tiers/tiers-form'
import { responseError } from '@/hooks/use-cursor-list'
import { TIERS_KIND_LABELS } from '@/lib/tiers/rules'

interface TiersData {
  kind: 'CUSTOMER' | 'SUPPLIER'
  name: string
  siren: string | null
  siret: string | null
  vatNumber: string | null
  email: string | null
  auxiliaryAccountNumber: string
  collectiveAccountCode: string | null
  defaultAccountCode: string | null
  defaultVatRateBp: number | null
  paymentTermsDays: number | null
  paymentTermsEndOfMonth: boolean | null
  notes: string | null
  address: { street: string; postalCode: string; city: string; country: string } | null
  _count: { invoices: number }
}

function toValues(t: TiersData): TiersFormValues {
  return {
    kind: t.kind,
    name: t.name,
    siren: t.siren ?? '',
    siret: t.siret ?? '',
    vatNumber: t.vatNumber ?? '',
    email: t.email ?? '',
    auxiliaryAccountNumber: t.auxiliaryAccountNumber,
    collectiveAccountCode: t.collectiveAccountCode ?? '',
    defaultAccountCode: t.defaultAccountCode ?? '',
    defaultVatRateBp: t.defaultVatRateBp === null ? 'none' : String(t.defaultVatRateBp),
    ownTerms: t.paymentTermsDays !== null,
    termsDays: String(t.paymentTermsDays ?? 30),
    termsEndOfMonth: t.paymentTermsEndOfMonth ?? false,
    street: t.address?.street ?? '',
    postalCode: t.address?.postalCode ?? '',
    city: t.address?.city ?? '',
    country: t.address?.country ?? 'FR',
    notes: t.notes ?? '',
  }
}

export default function TiersDetailPage() {
  const params = useParams()
  const companyId = params.companyId as string
  const tiersId = params.id as string
  const { can } = useCompanyAccess()
  const [tiers, setTiers] = React.useState<TiersData | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/tiers/${tiersId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'Le tiers ne s’est pas chargé.'))
        return response.json() as Promise<TiersData>
      })
      .then((data) => !cancelled && setTiers(data))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [tiersId])

  if (error) {
    return (
      <p role="alert" className="text-sm">
        {error}
      </p>
    )
  }
  if (!tiers) return <Skeleton className="h-96 w-full max-w-3xl" />
  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader
        title={tiers.name}
        description={`${TIERS_KIND_LABELS[tiers.kind]}, compte auxiliaire ${tiers.auxiliaryAccountNumber}${tiers._count.invoices ? `, ${tiers._count.invoices} facture${tiers._count.invoices > 1 ? 's' : ''}` : ''}.`}
      />
      <TiersForm
        companyId={companyId}
        tiersId={tiersId}
        initial={toValues(tiers)}
        locked={tiers._count.invoices > 0}
        canWrite={can({ entries: ['update'] })}
        canDelete={can({ entries: ['delete'] })}
      />
    </div>
  )
}
