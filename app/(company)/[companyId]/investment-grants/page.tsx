'use client'

import { useParams } from 'next/navigation'
import { InvestmentGrantsPage } from '@/components/features/year-end/investment-grants-page'

export default function CompanyInvestmentGrantsPage() {
  const params = useParams()
  return <InvestmentGrantsPage companyId={params.companyId as string} />
}
