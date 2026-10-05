'use client'

import * as React from 'react'
import Link from 'next/link'

interface VatSettings {
  servicesVatOnDebits: boolean
  isVatExempt: boolean
}

/**
 * When the VAT of the company's services is due (CGI art. 269, 2, c), read
 * only: the option is set with the VAT regimes in Informations
 * (VatOnDebitsCard), the single place it is edited.
 */
export function VatSettingsSummary({ companyId }: { companyId: string }) {
  const [settings, setSettings] = React.useState<VatSettings | null>(null)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/companies/${companyId}/vat-settings`)
      .then((response) => (response.ok ? (response.json() as Promise<VatSettings>) : null))
      .then((data) => !cancelled && setSettings(data))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [companyId])

  if (!settings || settings.isVatExempt) return null
  return (
    <p className="text-muted-foreground text-sm" data-testid="vat-settings-summary">
      TVA sur les prestations&nbsp;: {settings.servicesVatOnDebits ? 'd’après les débits' : 'exigible à l’encaissement'}.{' '}
      <Link href={`/${companyId}/informations#tva-debits`} className="text-link underline-offset-4 hover:underline">
        Modifier
      </Link>
    </p>
  )
}
