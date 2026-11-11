'use client'

import { useParams } from 'next/navigation'
import { LiassePage } from '@/components/features/liasse/liasse-page'

export default function CompanyLiassePage() {
  const params = useParams()
  return <LiassePage companyId={params.companyId as string} />
}
