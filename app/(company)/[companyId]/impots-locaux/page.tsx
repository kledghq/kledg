'use client'

import { useParams } from 'next/navigation'

import { LocalTaxesPage } from '@/components/features/local-taxes/local-taxes-page'

export default function ImpotsLocauxPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  return <LocalTaxesPage key={companyId} companyId={companyId} />
}
