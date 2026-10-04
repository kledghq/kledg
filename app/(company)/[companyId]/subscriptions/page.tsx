'use client'

import { useParams } from 'next/navigation'
import { SubscriptionsPage } from '@/components/features/subscriptions/subscriptions-page'

export default function CompanySubscriptionsPage() {
  const params = useParams()
  return <SubscriptionsPage companyId={params.companyId as string} />
}
