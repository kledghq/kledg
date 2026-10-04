'use client'

import { useParams } from 'next/navigation'
import { YearEndPage } from '@/components/features/year-end/year-end-page'

export default function CompanyYearEndPage() {
  const params = useParams()
  return <YearEndPage companyId={params.companyId as string} />
}
