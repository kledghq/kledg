'use client'

import { useParams } from 'next/navigation'
import { ConventionPage } from '@/components/features/management-fees/management-fee-pages'

export default function ConventionRoute() {
  const params = useParams()
  return <ConventionPage companyId={params.companyId as string} conventionId={params.id as string} />
}
