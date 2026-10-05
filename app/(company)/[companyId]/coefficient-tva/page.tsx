'use client'

import { useParams } from 'next/navigation'

import { VatDeductionPage } from '@/components/features/vat-deduction/vat-deduction-page'

export default function CoefficientTvaPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  return <VatDeductionPage key={companyId} companyId={companyId} />
}
