'use client'

import * as React from 'react'
import Link from 'next/link'

/**
 * On the sales invoices page: invites a company that existed before
 * automatic numbering, and still types its numbers, to configure it
 * (GET /api/companies/[id]/invoice-numbering, suggestAutomatic). Disappears
 * once the numbering is saved.
 */
export function NumberingSuggestion({ companyId }: { companyId: string }) {
  const [show, setShow] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/companies/${companyId}/invoice-numbering`)
      .then((response) => (response.ok ? (response.json() as Promise<{ suggestAutomatic?: boolean }>) : null))
      .then((data) => !cancelled && setShow(Boolean(data?.suggestAutomatic)))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [companyId])

  if (!show) return null
  return (
    <p role="status" className="rounded-md border px-3 py-2 text-sm" data-testid="numbering-suggestion">
      Les numéros de vos factures de vente sont saisis à la main. Kledg peut les numéroter automatiquement, sans trou ni doublon.{' '}
      <Link href={`/${companyId}/informations#numerotation-factures`} className="text-link underline-offset-4 hover:underline">
        Configurer la numérotation
      </Link>
    </p>
  )
}
