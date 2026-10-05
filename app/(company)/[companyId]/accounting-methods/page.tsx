'use client'

import { useParams } from 'next/navigation'
import { AccountingMethodsPage } from '@/components/features/annexe/accounting-methods-page'

export default function CompanyAccountingMethodsPage() {
  const params = useParams()
  return <AccountingMethodsPage companyId={params.companyId as string} />
}
