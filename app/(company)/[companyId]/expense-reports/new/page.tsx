'use client'

import { useParams } from 'next/navigation'
import { NewExpenseReportPage } from '@/components/features/expense-reports/expense-report-pages'

export default function NewExpenseReport() {
  const params = useParams()
  return <NewExpenseReportPage companyId={params.companyId as string} />
}
