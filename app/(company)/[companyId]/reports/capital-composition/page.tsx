'use client'

import { useParams } from 'next/navigation'
import { CapitalCompositionPage } from '@/components/features/year-end/capital-composition-page'

export default function CompanyCapitalCompositionPage() {
  const params = useParams()
  return <CapitalCompositionPage companyId={params.companyId as string} />
}
