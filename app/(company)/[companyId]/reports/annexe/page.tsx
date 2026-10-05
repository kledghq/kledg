'use client'

import { useParams } from 'next/navigation'
import { AnnexePage } from '@/components/features/annexe/annexe-page'

export default function CompanyAnnexePage() {
  const params = useParams()
  return <AnnexePage companyId={params.companyId as string} />
}
