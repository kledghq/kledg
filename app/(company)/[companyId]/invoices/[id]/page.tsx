'use client'

import { useParams } from 'next/navigation'
import { InvoiceDetailView } from '@/components/features/invoices/invoice-detail'

export default function InvoicePage() {
  const params = useParams()
  return <InvoiceDetailView companyId={params.companyId as string} invoiceId={params.id as string} />
}
