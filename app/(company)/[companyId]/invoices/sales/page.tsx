'use client'

import { useParams } from 'next/navigation'
import { InvoiceList } from '@/components/features/invoices/invoice-list'
import { VatSettingsCard } from '@/components/features/invoices/vat-settings-card'

export default function SalesInvoicesPage() {
  const params = useParams()
  const companyId = params.companyId as string
  return (
    <div className="space-y-6">
      <InvoiceList companyId={companyId} direction="SALE" />
      <VatSettingsCard companyId={companyId} />
    </div>
  )
}
