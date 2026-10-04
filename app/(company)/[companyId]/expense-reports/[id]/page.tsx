'use client'

import { useParams } from 'next/navigation'
import { ExpenseReportDetailView } from '@/components/features/expense-reports/expense-report-detail'

export default function ExpenseReportPage() {
  const params = useParams()
  return <ExpenseReportDetailView companyId={params.companyId as string} reportId={params.id as string} />
}
