'use client'

import { useParams } from 'next/navigation'
import { ProvisionsPage } from '@/components/features/year-end/provisions-page'

/** Impairments of fixed assets, stocks, receivables and securities (29, 39, 49, 59), with the overdue customers. */
export default function CompanyImpairmentsPage() {
  const params = useParams()
  return <ProvisionsPage companyId={params.companyId as string} group="impairments" />
}
