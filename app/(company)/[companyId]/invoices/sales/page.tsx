'use client'

import { useParams } from 'next/navigation'
import { InvoiceList } from '@/components/features/invoices/invoice-list'
import { VatSettingsSummary } from '@/components/features/invoices/vat-settings-summary'

export default function SalesInvoicesPage() {
  const params = useParams()
  const companyId = params.companyId as string
  return (
    <div className="space-y-6">
      <InvoiceList companyId={companyId} direction="SALE" />
      <VatSettingsSummary companyId={companyId} />
    </div>
  )
}
