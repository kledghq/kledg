'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared'
import { EXEMPT_TRAINING, InvoiceForm, type EditedNumber, type InvoiceDirection, type InvoiceFormValues } from '@/components/features/invoices/invoice-form'
import { responseError } from '@/hooks/use-cursor-list'
import { parseQuantity, quantityToString } from '@/lib/invoices/amounts'

interface LoadedLine {
  label: string
  quantity: string
  unitPriceCents: number
  vatRateBp: number
  accountCode: string | null
  nature: 'GOODS' | 'SERVICES'
  fixedAsset: boolean
  vatExemption?: string | null
}

interface Loaded {
  direction: InvoiceDirection
  number: string | null
  edited: EditedNumber
  values: InvoiceFormValues
}

export default function EditInvoicePage() {
  const params = useParams()
  const companyId = params.companyId as string
  const invoiceId = params.id as string
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/invoices/${invoiceId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'La facture ne s’est pas chargée.'))
        return response.json()
      })
      .then((invoice) => {
        if (cancelled) return
        setLoaded({
          direction: invoice.direction,
          number: invoice.number,
          edited: { origin: invoice.origin, number: invoice.number, provisionalNumber: invoice.provisionalNumber ?? null },
          values: {
            tiersId: invoice.tiers.id,
            number: invoice.number ?? '',
            numbering: 'kledg',
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            typeCode: invoice.typeCode,
            label: invoice.label ?? '',
            lines: (invoice.lines as LoadedLine[]).map((line) => ({
              label: line.label,
              quantity: quantityToString(parseQuantity(line.quantity) ?? 0).replace('.', ','),
              unitPriceCents: line.unitPriceCents,
              vatRateBp: line.vatExemption === 'training' ? EXEMPT_TRAINING : String(line.vatRateBp),
              accountCode: line.accountCode ?? '',
              nature: line.nature,
              fixedAsset: line.fixedAsset,
            })),
          },
        })
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [invoiceId])

  if (error) {
    return (
      <p role="alert" className="text-sm">
        {error}
      </p>
    )
  }
  if (!loaded) return <Skeleton className="h-96 w-full" />
  return (
    <div className="space-y-6">
      <PageHeader title={loaded.number ? `Modifier la facture ${loaded.number}` : 'Modifier la facture en brouillon'} description="Une facture se modifie tant qu’elle n’est pas comptabilisée." />
      <InvoiceForm companyId={companyId} direction={loaded.direction} invoiceId={invoiceId} initial={loaded.values} edited={loaded.edited} />
    </div>
  )
}
