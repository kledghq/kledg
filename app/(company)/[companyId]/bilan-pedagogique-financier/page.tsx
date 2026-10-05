'use client'

import { useParams } from 'next/navigation'

import { TrainingReportPage } from '@/components/features/training-report/training-report-page'

export default function BilanPedagogiqueFinancierPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  return <TrainingReportPage key={companyId} companyId={companyId} />
}
