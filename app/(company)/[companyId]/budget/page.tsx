'use client'

import { useParams } from 'next/navigation'
import { BudgetPage } from '@/components/features/budgets/budget-page'

export default function CompanyBudgetPage() {
  const params = useParams()
  return <BudgetPage companyId={params.companyId as string} />
}
