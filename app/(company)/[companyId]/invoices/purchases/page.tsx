'use client'

import { useParams } from 'next/navigation'
import { InvoiceList } from '@/components/features/invoices/invoice-list'

export default function PurchaseInvoicesPage() {
  const params = useParams()
  return <InvoiceList companyId={params.companyId as string} direction="PURCHASE" />
}
