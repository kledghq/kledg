'use client'

import { useParams } from 'next/navigation'
import { SimpleEntriesReview } from '@/components/features/simple-mode/simple-entries-review'

/** Expert mode, "Saisies du mode simple à valider" (docs/categories-simples.md). */
export default function SimpleModeEntriesPage() {
  const params = useParams()
  return <SimpleEntriesReview companyId={params.companyId as string} />
}
