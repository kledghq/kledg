'use client'

import { useParams } from 'next/navigation'

import { DeadlinesPage } from '@/components/features/deadlines/deadlines-view'

export default function EcheancesPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  return <DeadlinesPage key={companyId} companyId={companyId} />
}
