'use client'

import { useParams } from 'next/navigation'

import { RemunerationPage } from '@/components/features/remuneration/remuneration-page'

export default function RemunerationDividendesPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  return <RemunerationPage key={companyId} companyId={companyId} />
}
