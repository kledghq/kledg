'use client'

import { useParams } from 'next/navigation'
import { ExpenseReportList } from '@/components/features/expense-reports/expense-report-list'

export default function MyExpenseReportsPage() {
  const params = useParams()
  return <ExpenseReportList companyId={params.companyId as string} mine />
}
