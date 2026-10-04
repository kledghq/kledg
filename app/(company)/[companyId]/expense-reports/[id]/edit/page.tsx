'use client'

import { useParams } from 'next/navigation'
import { EditExpenseReportPage } from '@/components/features/expense-reports/expense-report-pages'

export default function EditExpenseReport() {
  const params = useParams()
  return <EditExpenseReportPage companyId={params.companyId as string} reportId={params.id as string} />
}
