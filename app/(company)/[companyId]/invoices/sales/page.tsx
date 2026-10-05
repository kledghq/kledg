'use client'

import { useParams } from 'next/navigation'
import { InvoiceList } from '@/components/features/invoices/invoice-list'
import { VatSettingsSummary } from '@/components/features/invoices/vat-settings-summary'
import { NumberingSuggestion } from '@/components/features/invoices/numbering-suggestion'

export default function SalesInvoicesPage() {
  const params = useParams()
  const companyId = params.companyId as string
  return (
    <div className="space-y-6">
      <NumberingSuggestion companyId={companyId} />
      <InvoiceList companyId={companyId} direction="SALE" />
      <VatSettingsSummary companyId={companyId} />
    </div>
  )
}
