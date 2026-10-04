'use client'

import { useParams } from 'next/navigation'
import { ExpensesReview } from '@/components/features/simple-mode/expenses-review'

/** Simple mode, "Dépenses à vérifier" (docs/categories-simples.md). */
export default function SimpleExpensesPage() {
  const params = useParams()
  return <ExpensesReview companyId={params.companyId as string} />
}
