'use client'

import { useParams } from 'next/navigation'
import { ProvisionsPage } from '@/components/features/year-end/provisions-page'

/** Provisions for risks and charges (151, 152). Impairments have their own page, /provisions/impairments. */
export default function CompanyProvisionsPage() {
  const params = useParams()
  return <ProvisionsPage companyId={params.companyId as string} group="risks" />
}
