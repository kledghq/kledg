'use client'

import * as React from 'react'
import Link from 'next/link'
import { CalendarClock, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/shared'
import {
  DEFAULT_DEADLINE_SETTINGS,
  VAT_FILING_DAY_MAX,
  VAT_FILING_DAY_MIN,
  defaultVatFilingDay,
  type DeadlineSettings,
  type VatCa3Frequency,
} from '@/lib/deadlines/settings'

type BooleanSetting = 'vatSimplifiedAcomptes' | 'isAcomptes' | 'cfeAcompte' | 'das2' | 'cvae' | 'accountsFiledOnline'

const SWITCHES: Array<{ key: BooleanSetting; label: string; hint: string }> = [
  {
    key: 'isAcomptes',
    label: "Acomptes d'impôt sur les sociétés",
    hint: "Désactivez si l'impôt de l'exercice de référence ne dépasse pas 3 000 € : l'impôt se paie alors en une fois, au solde.",
  },
  {
    key: 'vatSimplifiedAcomptes',
    label: 'Acomptes de TVA de juillet et décembre (réel simplifié)',
    hint: "Désactivez si la TVA de l'année précédente est inférieure à 1 000 €.",
  },
  {
    key: 'cfeAcompte',
    label: 'Acompte de CFE au 15 juin',
    hint: "Dû quand la CFE de l'année précédente atteignait 3 000 €.",
  },
  {
    key: 'das2',
    label: 'Déclaration des honoraires (DAS2)',
    hint: "Si la société verse plus de 2 400 € d'honoraires, commissions ou vacations à un même bénéficiaire dans l'année.",
  },
  {
    key: 'cvae',
    label: 'Déclaration de valeur ajoutée (1330-CVAE)',
    hint: "Obligatoire au-delà de 152 500 € de chiffre d'affaires hors taxes.",
  },
  {
    key: 'accountsFiledOnline',
    label: 'Dépôt des comptes au greffe en ligne',
    hint: "Le dépôt électronique laisse deux mois après l'approbation au lieu d'un.",
  },
]

const FREQUENCIES: Array<{ value: VatCa3Frequency; label: string }> = [
  { value: 'auto', label: 'Selon le régime de TVA' },
  { value: 'monthly', label: 'Mensuelle' },
  { value: 'quarterly', label: 'Trimestrielle (TVA annuelle inférieure à 4 000 €)' },
]

const same = (a: DeadlineSettings, b: DeadlineSettings) => (Object.keys(a) as Array<keyof DeadlineSettings>).every((k) => a[k] === b[k])

/**
 * "Échéances" card of the Informations page: what the deadline calendar
 * needs and Kledg cannot know (the CA3 day, the acomptes that depend on last
 * year's amounts...). Saved on its own (PUT /api/companies/[id]/deadline-settings),
 * never with the company form around it: it holds no text field, so Enter
 * cannot submit that form.
 */
export function DeadlineSettingsCard({ companyId, legalType, canEdit }: { companyId: string; legalType?: string | null; canEdit: boolean }) {
  const [saved, setSaved] = React.useState<DeadlineSettings | null>(null)
  const [draft, setDraft] = React.useState<DeadlineSettings>(DEFAULT_DEADLINE_SETTINGS)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    const failed = "Les paramètres des échéances ne se sont pas chargés. Réessayez dans un instant."
    fetch(`/api/companies/${companyId}/deadline-settings`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { settings?: DeadlineSettings; error?: string } | null
        if (!response.ok || !body?.settings) throw new Error(body?.error || failed)
        return body.settings
      })
      .then(
        (settings) => {
          if (cancelled) return
          setSaved(settings)
          setDraft(settings)
        },
        (e: unknown) => {
          if (!cancelled) setError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : failed)
        },
      )
    return () => {
      cancelled = true
    }
  }, [companyId, attempt])

  const retry = () => {
    setError(null)
    setAttempt((n) => n + 1)
  }

  const update = <K extends keyof DeadlineSettings>(key: K, value: DeadlineSettings[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const dirty = saved !== null && !same(saved, draft)
  const defaultDay = defaultVatFilingDay(legalType)

  async function save() {
    setSaving(true)
    try {
      const response = await fetch(`/api/companies/${companyId}/deadline-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const body = (await response.json().catch(() => null)) as { settings?: DeadlineSettings; error?: string } | null
      if (!response.ok || !body?.settings) {
        toast.error(body?.error || "Les paramètres n'ont pas été enregistrés. Réessayez dans un instant.")
        return
      }
      setSaved(body.settings)
      setDraft(body.settings)
      toast.success('Paramètres des échéances enregistrés')
    } catch {
      toast.error("Les paramètres n'ont pas été enregistrés. Vérifiez votre connexion puis réessayez.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card id="echeances" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock aria-hidden className="text-muted-foreground size-4" />
          Échéances
        </CardTitle>
        <CardDescription>
          Ce que le calendrier des{' '}
          <Link href={`/${companyId}/echeances`} className="text-link underline-offset-4 hover:underline">
            échéances
          </Link>{' '}
          ne peut pas deviner. Les régimes de TVA et d&apos;impôt sur les sociétés se règlent dans l&apos;historique des régimes fiscaux.
        </CardDescription>
      </CardHeader>
      <CardContent aria-busy={saved === null && !error ? true : undefined}>
        {error ? (
          <div className="flex flex-col items-start gap-2" role="alert">
            <p className="text-muted-foreground text-sm">{error}</p>
            <Button type="button" size="sm" variant="outline" onClick={retry}>
              Réessayer
            </Button>
          </div>
        ) : saved === null ? (
          <div className="space-y-4" aria-hidden>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Jour de déclaration de TVA"
                hint="Entre le 15 et le 24 du mois suivant selon la forme juridique, le département et le SIREN. Votre jour figure dans votre espace professionnel sur impots.gouv.fr."
              >
                <Select
                  value={draft.vatFilingDay === null ? 'auto' : String(draft.vatFilingDay)}
                  onValueChange={(value) => update('vatFilingDay', value === 'auto' ? null : Number(value))}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="deadline-vat-day" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Non renseigné (le {defaultDay}, au plus tôt)</SelectItem>
                    {Array.from({ length: VAT_FILING_DAY_MAX - VAT_FILING_DAY_MIN + 1 }, (_, i) => VAT_FILING_DAY_MIN + i).map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        Le {day}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Fréquence des déclarations CA3"
                hint={"Au réel normal, mensuelle par défaut. Le régime simplifié est supprimé en 2027\u00a0: la TVA passe alors à la CA3 trimestrielle."}
              >
                <Select value={draft.vatCa3Frequency} onValueChange={(value) => update('vatCa3Frequency', value as VatCa3Frequency)} disabled={!canEdit}>
                  <SelectTrigger id="deadline-vat-frequency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <ul className="divide-y">
              {SWITCHES.map((s) => (
                <li key={s.key} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 space-y-1">
                    <Label htmlFor={`deadline-${s.key}`}>{s.label}</Label>
                    <p id={`deadline-${s.key}-hint`} className="text-muted-foreground text-xs">
                      {s.hint}
                    </p>
                  </div>
                  <Switch
                    id={`deadline-${s.key}`}
                    aria-describedby={`deadline-${s.key}-hint`}
                    checked={draft[s.key]}
                    onCheckedChange={(checked) => update(s.key, checked)}
                    disabled={!canEdit}
                  />
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {dirty ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setDraft(saved)} disabled={saving}>
                  Annuler les modifications
                </Button>
              ) : null}
              <Button type="button" size="sm" onClick={() => void save()} loading={saving} disabled={!dirty || !canEdit}>
                <Save aria-hidden />
                Enregistrer les paramètres
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
