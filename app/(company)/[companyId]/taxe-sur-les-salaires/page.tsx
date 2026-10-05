'use client'

import { useParams } from 'next/navigation'

import { PayrollTaxPage } from '@/components/features/payroll-tax/payroll-tax-page'

export default function TaxeSurLesSalairesPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  return <PayrollTaxPage key={companyId} companyId={companyId} />
}
