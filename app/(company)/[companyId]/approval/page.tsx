'use client'

import { useParams } from 'next/navigation'
import { ApprovalPage } from '@/components/features/approval/approval-page'

export default function CompanyApprovalPage() {
  const params = useParams()
  return <ApprovalPage companyId={params.companyId as string} />
}
