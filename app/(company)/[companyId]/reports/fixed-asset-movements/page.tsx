'use client'

import { useParams } from 'next/navigation'
import { FixedAssetMovementsPage } from '@/components/features/annexe/fixed-asset-movements-page'

export default function CompanyFixedAssetMovementsPage() {
  const params = useParams()
  return <FixedAssetMovementsPage companyId={params.companyId as string} />
}
