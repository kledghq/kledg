'use client'

import { useParams } from 'next/navigation'
import { ExpensesReview } from '@/components/features/simple-mode/expenses-review'

/** Simple mode, "Recettes à vérifier": money in, the invoice it pays or its category (docs/categories-simples.md). */
export default function SimpleIncomePage() {
  const params = useParams()
  return <ExpensesReview companyId={params.companyId as string} side="credit" />
}
