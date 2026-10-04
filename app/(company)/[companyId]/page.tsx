'use client'

import { useParams } from 'next/navigation'

import { Dashboard } from '@/components/features/dashboard/dashboard'

export default function HomePage() {
  const params = useParams()
  const companyId = params?.companyId as string
  return <Dashboard key={companyId} companyId={companyId} />
}
