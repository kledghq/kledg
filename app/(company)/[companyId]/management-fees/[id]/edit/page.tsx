'use client'

import { useParams } from 'next/navigation'
import { EditConventionPage } from '@/components/features/management-fees/management-fee-pages'

export default function EditConventionRoute() {
  const params = useParams()
  return <EditConventionPage companyId={params.companyId as string} conventionId={params.id as string} />
}
