'use client'

import { useParams } from 'next/navigation'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { RuleLibraryPage } from '@/components/features/rules/rule-library'

/** Bibliothèque de règles: ready-made assignment rules, suggestions and copy from another company. */
export default function RulesLibraryPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  if (!companyId) return <NoCompanySelected />
  return <RuleLibraryPage companyId={companyId} />
}
