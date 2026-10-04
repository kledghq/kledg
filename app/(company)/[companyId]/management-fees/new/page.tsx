'use client'

import { useParams } from 'next/navigation'
import { NewConventionPage } from '@/components/features/management-fees/management-fee-pages'

export default function NewConventionRoute() {
  const params = useParams()
  return <NewConventionPage companyId={params.companyId as string} />
}
