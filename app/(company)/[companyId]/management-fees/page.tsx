'use client'

import { useParams } from 'next/navigation'
import { ManagementFeesPage } from '@/components/features/management-fees/management-fee-pages'

export default function ManagementFeesRoute() {
  const params = useParams()
  return <ManagementFeesPage companyId={params.companyId as string} />
}
