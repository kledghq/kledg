'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/shared'
import { InvoiceForm } from '@/components/features/invoices/invoice-form'

export default function NewInvoicePage() {
  const params = useParams()
  const search = useSearchParams()
  const direction = search.get('direction') === 'SALE' ? 'SALE' : 'PURCHASE'
  return (
    <div className="space-y-6">
      <PageHeader
        title={direction === 'SALE' ? 'Nouvelle facture de vente' : 'Nouvelle facture d’achat'}
        description="Enregistrez la facture ligne par ligne&nbsp;: Kledg calcule la TVA par taux et les totaux, puis la comptabilise quand vous le décidez."
      />
      <InvoiceForm key={direction} companyId={params.companyId as string} direction={direction} />
    </div>
  )
}
