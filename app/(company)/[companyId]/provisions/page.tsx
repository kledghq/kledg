'use client'

import { useParams } from 'next/navigation'
import { ProvisionsPage } from '@/components/features/year-end/provisions-page'

export default function CompanyProvisionsPage() {
  const params = useParams()
  return <ProvisionsPage companyId={params.companyId as string} />
}
