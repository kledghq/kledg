'use client'

import { useParams } from 'next/navigation'

import { CorporateTaxPage } from '@/components/features/corporate-tax/corporate-tax-page'

export default function ImpotSocietesPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  return <CorporateTaxPage key={companyId} companyId={companyId} />
}
