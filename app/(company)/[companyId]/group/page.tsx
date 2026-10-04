'use client'

import { useParams } from 'next/navigation'
import { GroupViewPage } from '@/components/features/group/group-view-page'

export default function GroupRoute() {
  const params = useParams()
  return <GroupViewPage companyId={params.companyId as string} />
}
