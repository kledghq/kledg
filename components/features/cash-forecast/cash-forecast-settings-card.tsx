'use client'

import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AmountInput } from '@/components/ui/amount-input'
import { Field } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import type { CashForecastComponent } from '@/lib/cash-forecast/components'
import type { CashForecastSettingsView } from '@/lib/cash-forecast/cash-forecast-settings.service'
import type { CashForecastSettings } from '@/lib/cash-forecast/settings'
import type { ForecastMode } from '@/lib/cash-forecast/wording'
import { formatCents } from './cash-forecast-alert'

const TEXT: Record<ForecastMode, { title: string; description: string; threshold: string; hint: string; none: string }> = {
  expert: {
    title: 'Seuil d’alerte',
    description:
      'Le solde minimum que la société veut garder. Le tableau de bord, l’accueil du mode simple et cette page signalent le premier jour où la prévision passe en dessous. L’horizon et les flux cochés ci-dessus sont enregistrés avec lui et servent à l’alerte.',
    threshold: 'Solde minimum',
    hint: 'Laissez vide pour ne pas être alerté. Un montant négatif correspond à un découvert autorisé.',
    none: 'Aucun seuil enregistré.',
  },
  simple: {
    title: 'Le minimum à garder sur votre compte',
    description: 'Kledg vous prévient sur l’accueil si votre compte risque de passer sous ce montant. La durée et les éléments cochés ci-dessus sont enregistrés avec lui.',
    threshold: 'Montant minimum',
    hint: 'Laissez vide pour ne pas être prévenu.',
    none: 'Aucun minimum enregistré.',
  },
}

/**
 * The threshold (and with it the horizon and the components on screen),
 * saved for the company with PUT /api/companies/[id]/cash-forecast-settings.
 * Members without settings:update read it without a form.
 */
export function CashForecastSettingsCard({
  companyId,
  mode,
  settings,
  horizonMonths,
  components,
  canEdit,
  onSaved,
}: {
  companyId: string
  mode: ForecastMode
  settings: CashForecastSettings
  horizonMonths: number
  components: readonly CashForecastComponent[]
  canEdit: boolean
  onSaved: (settings: CashForecastSettings) => void
}) {
  const text = TEXT[mode]
  const [threshold, setThreshold] = React.useState<number | null>(settings.thresholdCents)
  const [inputError, setInputError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (inputError) return
    setSaving(true)
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/cash-forecast-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thresholdCents: threshold, horizonMonths, components }),
      })
      if (!response.ok) {
        toast.error(await responseError(response, 'Le seuil n’a pas été enregistré. Réessayez dans un instant.'))
        return
      }
      const saved = (await response.json()) as CashForecastSettingsView
      toast.success(mode === 'simple' ? 'Minimum enregistré' : 'Seuil enregistré')
      onSaved(saved.settings)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{text.title}</h2>
        </CardTitle>
        <CardDescription>{text.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {canEdit ? (
          <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-end gap-3" noValidate>
            <Field label={text.threshold} hint={text.hint} error={inputError ?? undefined} className="min-w-56 flex-1 basis-56">
              <AmountInput value={threshold} onValueChange={setThreshold} onErrorChange={setInputError} allowNegative placeholder="5 000,00" />
            </Field>
            <Button type="submit" loading={saving}>
              Enregistrer
            </Button>
          </form>
        ) : (
          <p className="text-sm">
            {settings.thresholdCents === null ? text.none : `${text.threshold} : ${formatCents(settings.thresholdCents)}`}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
