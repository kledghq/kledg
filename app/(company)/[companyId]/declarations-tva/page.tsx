'use client'

import { useParams } from 'next/navigation'

import { VatReturnPage } from '@/components/features/vat-returns/vat-return-page'

export default function DeclarationsTvaPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  return <VatReturnPage key={companyId} companyId={companyId} />
}
