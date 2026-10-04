'use client'

import { useParams } from 'next/navigation'
import { ExpenseSettings } from '@/components/features/expense-reports/expense-settings'

export default function ExpenseSettingsPage() {
  const params = useParams()
  return <ExpenseSettings companyId={params.companyId as string} />
}
