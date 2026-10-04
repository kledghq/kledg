'use client'

import * as React from 'react'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError } from '@/hooks/use-cursor-list'

interface VatSettings {
  servicesVatOnDebits: boolean
  isVatExempt: boolean
}

/**
 * The option to pay VAT on services on debits (CGI art. 269, 2, c), which
 * decides where the VAT of a sales invoice of services posts: 44571 at once,
 * or 44574 until it is paid.
 */
export function VatSettingsCard({ companyId }: { companyId: string }) {
  const { can, denied } = useCompanyAccess()
  const mayUpdate = can({ settings: ['update'] })
  const [settings, setSettings] = React.useState<VatSettings | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/companies/${companyId}/vat-settings`)
      .then((response) => (response.ok ? (response.json() as Promise<VatSettings>) : null))
      .then((data) => !cancelled && setSettings(data))
    return () => {
      cancelled = true
    }
  }, [companyId])

  const change = async (servicesVatOnDebits: boolean) => {
    setSaving(true)
    try {
      const response = await fetch(`/api/companies/${companyId}/vat-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servicesVatOnDebits }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'L’option n’a pas été enregistrée. Réessayez.'))
      setSettings((await response.json()) as VatSettings)
      toast.success(servicesVatOnDebits ? 'TVA sur les débits enregistrée' : 'TVA sur les encaissements enregistrée')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>TVA sur les prestations de services</CardTitle>
        <CardDescription>
          {settings.isVatExempt
            ? 'La société bénéficie de la franchise en base de TVA (CGI art. 293 B) : ses factures de vente sont sans TVA et la TVA de ses achats n’est pas déductible.'
            : 'La TVA d’une prestation est exigible à l’encaissement, sauf option pour les débits (CGI art. 269, 2, c). Sans option, la TVA d’une facture de prestations attend au compte 44574 et passe au 44571 quand son règlement est enregistré. Les livraisons de biens restent taxées à la livraison.'}
        </CardDescription>
      </CardHeader>
      {!settings.isVatExempt ? (
        <CardContent className="space-y-3">
          {!mayUpdate ? <AccessNotice>{denied('changer cette option')}</AccessNotice> : null}
          <div className="flex items-center gap-3">
            <Switch id="vat-on-debits" checked={settings.servicesVatOnDebits} onCheckedChange={change} disabled={!mayUpdate || saving} />
            <Label htmlFor="vat-on-debits">Option pour le paiement de la TVA d’après les débits</Label>
          </div>
        </CardContent>
      ) : null}
    </Card>
  )
}
